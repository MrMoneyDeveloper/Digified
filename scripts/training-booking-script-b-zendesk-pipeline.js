/************************************************************
 * Script B — Zendesk Ticket Pipeline (Enhanced with Tags & Logging)
 * ----------------------------------------------------------
 * UPDATED: 2026-01-01
 *
 * IMPROVEMENTS:
 * ✅ Adds tag "training-room-booking" to all tickets (for filtering in Zendesk)
 * ✅ Includes booking_id as custom field for direct tracking
 * ✅ Detailed logging to LOGS sheet (success, errors, timestamps)
 * ✅ Better fallback: alert ticket if Zendesk API fails
 * ✅ Full booking context in ticket description
 *
 * SETUP:
 * 1. Script Properties required:
 *    - TRAINING_SHEET_ID (optional, if different from this project)
 *    - ZD_SUBDOMAIN (e.g., "cxexperts")
 *    - ZD_EMAIL (Zendesk agent email)
 *    - ZD_TOKEN (Zendesk API token)
 * 
 * 2. Create trigger:
 *    - installOnBookingsChange() — runs on BOOKINGS sheet changes
 *    - Or use Apps Script UI: Triggers > Add trigger > onFormSubmit
 ************************************************************/

const CFG_B = {
  SHEETS: {
    BOOKINGS: "BOOKINGS",
    LOGS: "LOGS",
  },
  SHEET_ID_PROP: "TRAINING_SHEET_ID",
  
  ZENDESK: {
    SUBDOMAIN_PROP: "ZD_SUBDOMAIN",
    EMAIL_PROP: "ZD_EMAIL",
    TOKEN_PROP: "ZD_TOKEN",
    
    // Tag for filtering in Zendesk
    BOOKING_TAG: "training-room-booking",
    
    // Custom field name for booking_id (you may need to adjust based on your Zendesk setup)
    CUSTOM_FIELD_ID: 30048959,  // Example: "Booking ID" field
  },
  
  // Fallback alert recipient
  ALERT_EMAIL: "alerts@cxexperts.com", // Change to your team email
};

/**
 * ===== TRIGGER INSTALLATION =====
 * Run this once to set up the onFormSubmit trigger
 */
function installOnBookingsChange() {
  const ss = getSS_B_();
  const sh = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
  
  if (!sh) {
    logError_B_("BOOKINGS sheet not found", {});
    return;
  }
  
  // Remove any existing triggers for this script
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "onBookingsChange") {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Install new trigger: onFormSubmit fires when new row is added
  ScriptApp.newTrigger("onBookingsChange")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  
  logInfo_B_("Trigger installed for BOOKINGS sheet", { handler: "onBookingsChange" });
}

/**
 * ===== MAIN HANDLER (Triggered on new booking) =====
 */
function onBookingsChange(e) {
  try {
    const requestId = "req_" + Date.now();
    logInfo_B_("Trigger fired", { requestId, eventType: e.triggerSource });
    
    const ss = getSS_B_();
    processUnticketedBookings_(ss, requestId);
    
  } catch (err) {
    logError_B_("onBookingsChange failed", {
      error: String(err),
      stack: err.stack || "",
    });
  }
}

/**
 * ===== MAIN LOGIC: Process bookings without tickets =====
 */
function processUnticketedBookings_(ss, requestId) {
  const sh = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
  if (!sh) {
    logError_B_("BOOKINGS sheet not found", { requestId });
    return;
  }
  
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    logInfo_B_("No bookings to process", { requestId });
    return;
  }
  
  const header = values[0].map(String);
  const idx = indexMap_B_(header);
  
  // Ensure Zendesk columns exist
  ensureZendeskColumns_(sh, header, idx);
  
  for (let row = 1; row < values.length; row++) {
    const booking = readBookingRow_(values[row], idx);
    
    // Skip: already has ticket, failed booking, or cancelled
    if (booking.zendesk_ticket_id || booking.booking_status !== "booked") {
      continue;
    }
    
    logInfo_B_("Processing booking", {
      requestId,
      booking_id: booking.booking_id,
      requester_email: booking.requester_email,
    });
    
    // Try to create Zendesk ticket
    const result = createZendeskTicket_(booking, requestId);
    
    if (result.success) {
      logInfo_B_("Zendesk ticket created", {
        requestId,
        booking_id: booking.booking_id,
        ticket_id: result.ticket_id,
        ticket_url: result.ticket_url,
      });
      
      // Write back ticket info
      setCellIf_B_(sh, row + 1, idx.zendesk_ticket_id, result.ticket_id);
      setCellIf_B_(sh, row + 1, idx.zendesk_ticket_url, result.ticket_url);
      setCellIf_B_(sh, row + 1, idx.zendesk_status, "created");
      setCellIf_B_(sh, row + 1, idx.zendesk_attempted_at, new Date().toISOString());
      
    } else {
      logError_B_("Zendesk ticket creation failed", {
        requestId,
        booking_id: booking.booking_id,
        error_code: result.error_code,
        error_details: result.error_details,
      });
      
      // Write back error info
      setCellIf_B_(sh, row + 1, idx.zendesk_status, "failed");
      setCellIf_B_(sh, row + 1, idx.zendesk_error_code, result.error_code);
      setCellIf_B_(sh, row + 1, idx.zendesk_error_details, truncate_B_(result.error_details, 200));
      setCellIf_B_(sh, row + 1, idx.zendesk_attempted_at, new Date().toISOString());
      
      // Create alert ticket as fallback
      createAlertTicket_(booking, result, requestId);
    }
  }
}

/**
 * ===== CREATE ZENDESK TICKET =====
 */
function createZendeskTicket_(booking, requestId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const subdomain = props.getProperty(CFG_B.ZENDESK.SUBDOMAIN_PROP);
    const email = props.getProperty(CFG_B.ZENDESK.EMAIL_PROP);
    const token = props.getProperty(CFG_B.ZENDESK.TOKEN_PROP);
    
    if (!subdomain || !email || !token) {
      return {
        success: false,
        error_code: "ZENDESK_CREDS_MISSING",
        error_details: "Zendesk credentials not configured in Script Properties",
      };
    }
    
    // Parse slot to get date & time
    const slotParsed = parseSlotId_B_(booking.slot_id);
    const slotTime = slotParsed 
      ? `${slotParsed.date} at ${slotParsed.start_time} SAST`
      : booking.slot_id;
    
    // Build ticket payload
    const ticketPayload = {
      ticket: {
        subject: `Training Room Booking - ${slotTime}`,
        description: buildTicketDescription_(booking, slotTime),
        requester: {
          name: booking.requester_name || "Guest",
          email: booking.requester_email,
        },
        tags: [
          CFG_B.ZENDESK.BOOKING_TAG,  // Main tracking tag
          "api-integration",
          "automated",
        ],
        custom_fields: [
          {
            id: CFG_B.ZENDESK.CUSTOM_FIELD_ID,
            value: booking.booking_id, // Booking reference
          },
        ],
        // Optional: assign to specific group
        // group_id: 12345,
        // priority: "normal",
      },
    };
    
    const url = `https://${subdomain}.zendesk.com/api/v2/tickets.json`;
    const auth = Utilities.base64Encode(`${email}/token:${token}`);
    
    const options = {
      method: "post",
      headers: {
        "Authorization": "Basic " + auth,
        "Content-Type": "application/json",
      },
      payload: JSON.stringify(ticketPayload),
      muteHttpExceptions: true,
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (status === 201 || status === 200) {
      const json = JSON.parse(responseText);
      const ticket = json.ticket || {};
      
      return {
        success: true,
        ticket_id: ticket.id || "",
        ticket_url: `https://${subdomain}.zendesk.com/agent/tickets/${ticket.id}`,
      };
    } else {
      return {
        success: false,
        error_code: `HTTP_${status}`,
        error_details: `Zendesk API error: ${responseText.slice(0, 500)}`,
      };
    }
    
  } catch (err) {
    return {
      success: false,
      error_code: "EXCEPTION",
      error_details: String(err),
    };
  }
}

/**
 * ===== BUILD RICH TICKET DESCRIPTION =====
 */
function buildTicketDescription_(booking, slotTime) {
  let desc = `Training Room Booking Confirmation\n`;
  desc += `=====================================\n\n`;
  
  desc += `**Booking Reference:** ${booking.booking_id}\n`;
  desc += `**Session:** ${slotTime}\n`;
  desc += `**Requester:** ${booking.requester_name} (${booking.requester_email})\n`;
  desc += `**Attendees:** ${booking.attendees || 1}\n`;
  desc += `**Department:** ${booking.dept || "All"}\n`;
  desc += `**User Type:** ${booking.user_type || "Unknown"}\n`;
  
  if (booking.notes) {
    desc += `\n**Notes:**\n${booking.notes}\n`;
  }
  
  desc += `\n**Booked At:** ${booking.booked_at || "Unknown"}\n`;
  desc += `\n---\n`;
  desc += `*This ticket was auto-created via Training Room Booking API*\n`;
  
  return desc;
}

/**
 * ===== CREATE ALERT TICKET (Fallback) =====
 * If Zendesk creation fails, create an alert ticket for your team
 */
function createAlertTicket_(booking, zdResult, requestId) {
  try {
    const subject = `⚠️ ALERT: Training booking ticket failed - ${booking.booking_id}`;
    const body = `A training room booking could not be auto-ticketed in Zendesk.\n\n`
      + `Booking ID: ${booking.booking_id}\n`
      + `Requester: ${booking.requester_name} <${booking.requester_email}>\n`
      + `Slot: ${booking.slot_id}\n`
      + `Error: ${zdResult.error_code}\n`
      + `Details: ${zdResult.error_details}\n\n`
      + `Please create a manual ticket for this booking.`;
    
    // Send email to your team
    MailApp.sendEmail(
      CFG_B.ALERT_EMAIL,
      subject,
      body,
      { from: Session.getActiveUser().getEmail() }
    );
    
    logInfo_B_("Alert email sent to team", {
      requestId,
      booking_id: booking.booking_id,
      recipient: CFG_B.ALERT_EMAIL,
    });
    
  } catch (err) {
    logError_B_("Failed to send alert email", {
      error: String(err),
      booking_id: booking.booking_id,
    });
  }
}

/**
 * ===== HELPER: Ensure Zendesk columns exist =====
 */
function ensureZendeskColumns_(sh, header, idx) {
  const expectedCols = [
    { name: "zendesk_status", minIndex: 11 },
    { name: "zendesk_ticket_id", minIndex: 12 },
    { name: "zendesk_ticket_url", minIndex: 13 },
    { name: "zendesk_error_code", minIndex: 14 },
    { name: "zendesk_error_details", minIndex: 15 },
    { name: "zendesk_attempted_at", minIndex: 16 },
  ];
  
  let lastCol = sh.getLastColumn();
  
  expectedCols.forEach(col => {
    if (!header.includes(col.name)) {
      lastCol++;
      sh.getRange(1, lastCol).setValue(col.name);
    }
  });
  
  sh.autoResizeColumns(1, sh.getLastColumn());
}

/**
 * ===== HELPER: Read a booking row =====
 */
function readBookingRow_(row, idx) {
  return {
    booking_id: String(row[idx.booking_id] || ""),
    slot_id: String(row[idx.slot_id] || ""),
    booking_status: lower_B_(row[idx.booking_status] || ""),
    fail_code: String(row[idx.fail_code] || ""),
    requester_email: lower_B_(row[idx.requester_email] || ""),
    requester_name: String(row[idx.requester_name] || ""),
    attendees: row[idx.attendees] || 1,
    notes: String(row[idx.notes] || ""),
    dept: String(row[idx.dept] || ""),
    booked_at: String(row[idx.booked_at] || ""),
    debug_json: String(row[idx.debug_json] || ""),
    
    zendesk_status: String(row[idx.zendesk_status] || ""),
    zendesk_ticket_id: String(row[idx.zendesk_ticket_id] || ""),
    zendesk_ticket_url: String(row[idx.zendesk_ticket_url] || ""),
    zendesk_error_code: String(row[idx.zendesk_error_code] || ""),
    zendesk_error_details: String(row[idx.zendesk_error_details] || ""),
    zendesk_attempted_at: String(row[idx.zendesk_attempted_at] || ""),
  };
}

/**
 * ===== SMALL UTILS =====
 */
function setSS_B_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(CFG_B.SHEET_ID_PROP);
  return sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSS_B_() {
  return setSS_B_();
}

function setCellIf_B_(sheet, rowNum, colIdx, value) {
  if (colIdx === undefined || colIdx === null || colIdx < 0) return;
  if (value === undefined) return;
  sheet.getRange(rowNum, colIdx + 1).setValue(value);
}

function indexMap_B_(header) {
  const m = {};
  for (let i = 0; i < header.length; i++) {
    const key = String(header[i] || "").trim();
    if (!key) continue;
    m[key] = i;
  }
  
  return {
    booking_id: m.booking_id ?? 0,
    slot_id: m.slot_id ?? 1,
    booking_status: m.booking_status ?? 2,
    fail_code: m.fail_code ?? 3,
    requester_email: m.requester_email ?? 4,
    requester_name: m.requester_name ?? 5,
    attendees: m.attendees ?? 6,
    notes: m.notes ?? 7,
    dept: m.dept ?? 8,
    booked_at: m.booked_at ?? 9,
    debug_json: m.debug_json ?? 10,
    
    zendesk_status: m.zendesk_status ?? -1,
    zendesk_ticket_id: m.zendesk_ticket_id ?? -1,
    zendesk_ticket_url: m.zendesk_ticket_url ?? -1,
    zendesk_error_code: m.zendesk_error_code ?? -1,
    zendesk_error_details: m.zendesk_error_details ?? -1,
    zendesk_attempted_at: m.zendesk_attempted_at ?? -1,
  };
}

function parseSlotId_B_(slotId) {
  const s = String(slotId || "").trim().toUpperCase();
  const m = s.match(/^SLOT_(\\d{4}-\\d{2}-\\d{2})_(\\d{4})$/);
  if (!m) return null;
  const date = m[1];
  const hhmm = m[2];
  const start_time = hhmm.slice(0, 2) + ":" + hhmm.slice(2, 4);
  return { date, start_time };
}

function lower_B_(v) { return String(v || "").trim().toLowerCase(); }
function truncate_B_(s, maxLen) {
  s = String(s || "");
  if (!maxLen || s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

/**
 * ===== LOGGING =====
 */
function logInfo_B_(message, meta) { appendLog_B_("INFO", message, meta); }
function logWarn_B_(message, meta) { appendLog_B_("WARN", message, meta); }
function logError_B_(message, meta) { appendLog_B_("ERROR", message, meta); }

function appendLog_B_(level, message, meta) {
  try {
    const ss = getSS_B_();
    let sh = ss.getSheetByName(CFG_B.SHEETS.LOGS);
    
    if (!sh) {
      sh = ss.insertSheet(CFG_B.SHEETS.LOGS);
      sh.getRange(1, 1, 1, 4).setValues([["timestamp", "level", "message", "meta_json"]]);
      sh.setFrozenRows(1);
    }
    
    sh.appendRow([
      new Date().toISOString(),
      level,
      message,
      JSON.stringify(meta || {}),
    ]);
  } catch (e) {
    console.log(`[${level}] ${message}`, meta);
  }
}