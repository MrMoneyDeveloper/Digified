// Placeholder for Script B (Apps Script).
// The live script is deployed outside this repo. See apps_scripts/README.md.

/************************************************************
 * Script B — Zendesk Ticket Pipeline (Google Apps Script)
 * ----------------------------------------------------------
 * UPDATED: 2026-01-09
 *
 * FIXES ADDED (your current issue):
 * ✅ Do NOT treat JSON in zendesk_ticket_id as “has_ticket_id”
 * ✅ Auto-repair: move that JSON into debug_json, clear zendesk_ticket_id
 * ✅ Auto-backfill: if zendesk_ticket_url has /tickets/123, write zendesk_ticket_id=123
 * ✅ Enforce REQUIRED tag: "training-room-booking" on every created ticket (so your View catches it)
 * ✅ Script Properties now OVERRIDE hardcoded creds (so you can switch subdomain to match your View)
 * ✅ Fixed processOneBooking() typo bug
 *
 * NOTE (important):
 * Your View screenshot is on **cxsupporthub.zendesk.com**.
 * If your tickets are being created on **cxe-internal.zendesk.com**, they will never show in that View.
 * Set Script Property `ZD_SUBDOMAIN=cxsupporthub` (or change HARDCODED_SUBDOMAIN) to align.
 ************************************************************/

/* =========================
 * CONFIG
 * ========================= */
const CFG_B = {
  SHEETS: {
    BOOKINGS: "BOOKINGS",
    LOGS: "LOGS",
    FAILED_QUEUE: "FAILED_QUEUE",
  },

  SHEET_ID_PROP: "TRAINING_SHEET_ID",

  PIPELINE: {
    LIMIT_PER_RUN: 50,
    PROCESS_LATEST_FIRST: true,
    ONLY_IF_BOOKED: true,
    MAX_RETRIES: 3,
    RETRY_WAIT_MS_BASE: 1500,

    // ✅ NEW: auto-fix your sheet when columns got polluted
    AUTO_REPAIR_MISPLACED_JSON_IN_TICKET_ID: true,
    AUTO_BACKFILL_TICKET_ID_FROM_URL: true,
  },

  // ✅ NEW: tag enforcement for your Zendesk View
  TAGS: {
    REQUIRED: ["training-room-booking"],
    DEFAULT: ["api-integration", "automated"],
  },

  DEBUG_MODE: true,

  RATE_LIMIT: {
    BATCH_DELAY_MS: 200,
  },

  ZENDESK: {
    // PoC defaults (Script Properties override these now)
    HARDCODED_SUBDOMAIN: "cxe-internal",
    HARDCODED_EMAIL: "mohammed@cxexperts.co.za",
    HARDCODED_TOKEN: "7zB3NB6vMdOyV6riWS7SDdAJCSbMYP1Rm5D27pqG",

    HARDCODED_BRAND_ID: "",
    HARDCODED_FORM_ID: "",
    HARDCODED_ALERT_FORM_ID: "",
    HARDCODED_ALERT_REQUESTER_EMAIL: "",
    HARDCODED_ERROR_EMAIL_TO: "",

    CUSTOM_FIELD_BOOKING_ID: 24568268312988,

    SUBDOMAIN_PROP: "ZD_SUBDOMAIN",
    EMAIL_PROP: "ZD_EMAIL",
    TOKEN_PROP: "ZD_TOKEN",
    BRAND_ID_PROP: "ZD_BRAND_ID",
    FORM_ID_PROP: "ZD_TRAINING_FORM_ID",
    ALERT_FORM_ID_PROP: "ZD_ALERT_FORM_ID",
    ALERT_REQUESTER_EMAIL_PROP: "ZD_ALERT_REQUESTER_EMAIL",
    ERROR_EMAIL_TO_PROP: "ZD_ERROR_EMAIL_TO",
  }
};


/* =========================
 * SETUP / DIAGNOSTICS
 * ========================= */

function setupScriptB() {
  Logger.log("=== SCRIPT B SETUP ===");
  Logger.log("\n1️⃣ Set Script A spreadsheet ID in THIS Script (Script B):");
  Logger.log("   Project Settings → Script Properties");
  Logger.log("   Name:  TRAINING_SHEET_ID");
  Logger.log("   Value: [Script A spreadsheet ID]");
  Logger.log("\n2️⃣ (Optional but recommended) Zendesk properties (override hardcoded):");
  Logger.log("   ZD_SUBDOMAIN, ZD_EMAIL, ZD_TOKEN, ZD_TRAINING_FORM_ID, etc.");
  Logger.log("\n3️⃣ Run: testSheetLocation()");
}

function testSheetLocation() {
  const runId = makeRunId_B_();
  const props = PropertiesService.getScriptProperties();
  const sheetIdProp = props.getProperty(CFG_B.SHEET_ID_PROP);

  Logger.log("=== SHEET LOCATION DIAGNOSTIC ===");
  Logger.log("run_id: " + runId);
  Logger.log("Script property TRAINING_SHEET_ID: " + (sheetIdProp || "❌ NOT SET"));

  if (!sheetIdProp) {
    Logger.log("\n❌ CRITICAL: TRAINING_SHEET_ID is not configured!");
    Logger.log("🔧 FIX: Run setupScriptB()");
    return { error: "TRAINING_SHEET_ID_NOT_SET", action: "Run setupScriptB()", run_id: runId };
  }

  try {
    const ss = SpreadsheetApp.openById(sheetIdProp);
    Logger.log("✅ Spreadsheet accessible: " + ss.getName());
    Logger.log("   ID: " + ss.getId());
    Logger.log("   URL: " + ss.getUrl());

    const bookingsSheet = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
    if (!bookingsSheet) {
      Logger.log("\n❌ BOOKINGS sheet NOT found in that spreadsheet!");
      Logger.log("Available sheets:");
      ss.getSheets().forEach(sh => Logger.log("  - " + sh.getName()));
      return {
        error: "BOOKINGS_SHEET_NOT_FOUND",
        available_sheets: ss.getSheets().map(s => s.getName()),
        run_id: runId
      };
    }

    Logger.log("✅ BOOKINGS sheet found");
    Logger.log("   Rows: " + bookingsSheet.getLastRow());
    Logger.log("   Columns: " + bookingsSheet.getLastColumn());

    const header = bookingsSheet.getRange(1, 1, 1, bookingsSheet.getLastColumn()).getValues()[0];
    Logger.log("\n=== COLUMN HEADERS ===");
    header.forEach((h, i) => Logger.log(`  [${i}] "${String(h || "").trim()}"`));

    if (bookingsSheet.getLastRow() > 1) {
      Logger.log("\n=== SAMPLE BOOKING (ROW 2) ===");
      const row = bookingsSheet.getRange(2, 1, 1, bookingsSheet.getLastColumn()).getValues()[0];
      const idx = indexMap_B_(header);
      Logger.log("booking_id: " + safeCell_B_(row, idx.booking_id));
      Logger.log("slot_id: " + safeCell_B_(row, idx.slot_id));
      Logger.log("booking_status: " + safeCell_B_(row, idx.booking_status));
      Logger.log("requester_email: " + safeCell_B_(row, idx.requester_email));
      Logger.log("zendesk_status: " + safeCell_B_(row, idx.zendesk_status));
      Logger.log("zendesk_ticket_id: " + safeCell_B_(row, idx.zendesk_ticket_id));
      Logger.log("zendesk_ticket_url: " + safeCell_B_(row, idx.zendesk_ticket_url));
    }

    return { success: true, spreadsheet: ss.getName(), rows: bookingsSheet.getLastRow(), columns: bookingsSheet.getLastColumn(), run_id: runId };

  } catch (e) {
    Logger.log("\n❌ Cannot access spreadsheet: " + e.toString());
    return { error: "CANNOT_ACCESS_SPREADSHEET", details: e.toString(), run_id: runId };
  }
}


/* =========================
 * INIT / TRIGGERS
 * ========================= */

function initZendeskPipeline() {
  const runId = makeRunId_B_();
  const ss = getSS_B_();

  ensureSheetWithHeader_B_(ss, CFG_B.SHEETS.LOGS, [
    "timestamp",
    "level",
    "message",
    "meta_json",
  ]);

  ensureSheetWithHeader_B_(ss, CFG_B.SHEETS.FAILED_QUEUE, [
    "booking_id",
    "error_code",
    "retry_count",
    "last_attempt",
    "next_retry",
    "error_details",
  ]);

  const bookings = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
  if (!bookings) throw new Error("BOOKINGS sheet not found. This must be Script A spreadsheet.");

  ensureColumns_B_(bookings, [
    "zendesk_status",
    "zendesk_ticket_id",
    "zendesk_ticket_url",
    "zendesk_error_code",
    "zendesk_error_details",
    "zendesk_attempted_at",
    "alert_ticket_id",
    "alert_ticket_url",
  ]);

  logInfo_B_("✅ Init complete (columns ensured).", { run_id: runId, spreadsheet: ss.getName() });
  Logger.log("Initialization complete. Check LOGS sheet for details.");
  return { ok: true, run_id: runId };
}

function createZendeskTrigger() {
  const runId = makeRunId_B_();
  const fnName = "processPendingBookingsTrigger";
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction && t.getHandlerFunction() === fnName);

  if (exists) {
    logInfo_B_("⚠️ Trigger already exists", { run_id: runId, fn: fnName });
    Logger.log("Trigger already exists: " + fnName);
    return { ok: true, exists: true, run_id: runId };
  }

  ScriptApp.newTrigger(fnName)
    .timeBased()
    .everyMinutes(5)
    .create();

  logInfo_B_("✅ Trigger created", { run_id: runId, fn: fnName, interval: "5 minutes" });
  Logger.log("Trigger created: " + fnName + " (every 5 minutes)");
  return { ok: true, created: true, run_id: runId };
}

function processPendingBookingsTrigger() {
  processPendingBookings({ limit: CFG_B.PIPELINE.LIMIT_PER_RUN });
}


/* =========================
 * ✅ NEW: ONE-CLICK REPAIR (fix your “JSON in zendesk_ticket_id” problem)
 * ========================= */
function repairBookingsZendeskColumns(opts) {
  const runId = makeRunId_B_();
  const ss = getSS_B_();
  const sh = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
  if (!sh) return { error: "BOOKINGS_NOT_FOUND", run_id: runId };

  const dryRun = opts && opts.dryRun === true;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, repaired: 0, run_id: runId };

  const header = values[0].map(h => String(h || "").trim());
  const idx = indexMap_B_(header);

  const missingRequired = listMissingRequiredCols_B_(idx);
  if (missingRequired.length) {
    logError_B_("❌ Missing required columns (repair aborted)", { run_id: runId, missing: missingRequired });
    return { error: "MISSING_REQUIRED_COLUMNS", missing: missingRequired, run_id: runId };
  }

  let movedJson = 0;
  let backfilledId = 0;

  for (let r = 1; r < values.length; r++) {
    const rowNum = r + 1;
    const row = values[r];

    const rawTicketCell = String(safeCell_B_(row, idx.zendesk_ticket_id) || "").trim();
    const rawUrl = String(safeCell_B_(row, idx.zendesk_ticket_url) || "").trim();
    const rawDebug = String(safeCell_B_(row, idx.debug_json) || "").trim();

    // Move misplaced JSON out of zendesk_ticket_id
    const norm = normalizeZendeskTicketId_B_(rawTicketCell);
    if (norm.is_json && !rawDebug) {
      movedJson++;
      if (!dryRun) {
        setCellIf_B_(sh, rowNum, idx.debug_json, norm.json_text);
        setCellIf_B_(sh, rowNum, idx.zendesk_ticket_id, "");
      }
    }

    // Backfill ticket id from URL
    const derivedId = extractTicketIdFromUrl_B_(rawUrl);
    if (derivedId && !isValidTicketId_B_(rawTicketCell)) {
      backfilledId++;
      if (!dryRun) {
        setCellIf_B_(sh, rowNum, idx.zendesk_ticket_id, derivedId);
        const zs = lower_B_(safeCell_B_(row, idx.zendesk_status));
        if (zs !== "created") setCellIf_B_(sh, rowNum, idx.zendesk_status, "created");
      }
    }
  }

  const result = { ok: true, run_id: runId, moved_json_to_debug: movedJson, backfilled_ticket_ids: backfilledId, dryRun };
  logInfo_B_("🧹 Repair complete", result);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


/* =========================
 * MAIN PIPELINE
 * ========================= */

function processPendingBookings(opts) {
  const runId = makeRunId_B_();
  const startedAt = Date.now();

  let ss, sh;
  try {
    ss = getSS_B_();
    sh = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
  } catch (e) {
    logError_B_("❌ CRITICAL: Cannot open spreadsheet", { run_id: runId, error: String(e), stack: e && e.stack ? e.stack : "" });
    throw e;
  }

  if (!sh) {
    logError_B_("❌ CRITICAL: BOOKINGS sheet not found", {
      run_id: runId,
      spreadsheet: ss ? ss.getName() : "(unknown)",
      spreadsheet_id: ss ? ss.getId() : "(unknown)"
    });
    throw new Error("BOOKINGS sheet not found. Run testSheetLocation() to diagnose.");
  }

  const limit = (opts && opts.limit) ? parseInt(opts.limit, 10) : CFG_B.PIPELINE.LIMIT_PER_RUN;

  ensureColumns_B_(sh, [
    "zendesk_status",
    "zendesk_ticket_id",
    "zendesk_ticket_url",
    "zendesk_error_code",
    "zendesk_error_details",
    "zendesk_attempted_at",
    "alert_ticket_id",
    "alert_ticket_url",
  ]);

  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    logInfo_B_("📭 No bookings to process", { run_id: runId, total_rows: values.length });
    return { run_id: runId, processed: 0, attempted: 0, created: 0, failed: 0, skipped: 0, took_ms: Date.now() - startedAt };
  }

  const headerRaw = values[0].map(h => String(h || "").trim());
  const idx = indexMap_B_(headerRaw);

  const missingRequired = listMissingRequiredCols_B_(idx);
  if (missingRequired.length) {
    logError_B_("❌ Missing required columns (mapping invalid)", {
      run_id: runId,
      missing: missingRequired,
      headers: headerRaw
    });
    return { run_id: runId, error: "MISSING_REQUIRED_COLUMNS", missing: missingRequired, took_ms: Date.now() - startedAt };
  }

  if (CFG_B.DEBUG_MODE) {
    logInfo_B_("📊 Sheet scan starting", {
      run_id: runId,
      spreadsheet: ss.getName(),
      total_rows: values.length - 1,
      limit,
      header_cols: headerRaw.length,
      idx_preview: idx
    });
  }

  const creds = getZendeskCreds_B_();
  if (!creds.subdomain || !creds.email || !creds.token) {
    logWarn_B_("⚠️ Zendesk creds missing (skipping run).", {
      run_id: runId,
      hasSubdomain: !!creds.subdomain,
      hasEmail: !!creds.email,
      hasToken: !!creds.token
    });
    return { run_id: runId, processed: 0, attempted: 0, created: 0, failed: 0, skipped: 0, reason: "ZENDESK_NOT_CONFIGURED", took_ms: Date.now() - startedAt };
  }

  const out = { run_id: runId, processed: 0, attempted: 0, created: 0, failed: 0, skipped: 0 };
  const skipReasons = {};
  let requestsMade = 0;

  const rowOrder = [];
  if (CFG_B.PIPELINE.PROCESS_LATEST_FIRST) {
    for (let r = values.length - 1; r >= 1; r--) rowOrder.push(r);
  } else {
    for (let r = 1; r < values.length; r++) rowOrder.push(r);
  }

  for (let k = 0; k < rowOrder.length; k++) {
    if (out.processed >= limit) break;

    const r = rowOrder[k];
    const row = values[r];

    try {
      const bookingId = String(safeCell_B_(row, idx.booking_id) || "").trim();
      const slotId = String(safeCell_B_(row, idx.slot_id) || "").trim();
      const bookingStatus = lower_B_(safeCell_B_(row, idx.booking_status));

      const zdStatusRaw = String(safeCell_B_(row, idx.zendesk_status) || "").trim();
      const zdStatus = lower_B_(zdStatusRaw);

      const zdUrlRaw = String(safeCell_B_(row, idx.zendesk_ticket_url) || "").trim();
      const rawTicketCell = String(safeCell_B_(row, idx.zendesk_ticket_id) || "").trim();

      // ✅ NEW: normalize ticket id (digits only), detect JSON pollution
      const norm = normalizeZendeskTicketId_B_(rawTicketCell);
      let zdTicketId = norm.ticket_id;

      // ✅ NEW: if JSON got written into zendesk_ticket_id, move it to debug_json + clear ticket_id
      if (CFG_B.PIPELINE.AUTO_REPAIR_MISPLACED_JSON_IN_TICKET_ID && norm.is_json) {
        const currentDebug = String(safeCell_B_(row, idx.debug_json) || "").trim();

        if (!currentDebug && idx.debug_json >= 0) {
          setCellIf_B_(sh, r + 1, idx.debug_json, norm.json_text);
        }
        if (idx.zendesk_ticket_id >= 0) {
          setCellIf_B_(sh, r + 1, idx.zendesk_ticket_id, "");
        }
        zdTicketId = ""; // allow processing
      }

      // ✅ NEW: if URL exists, backfill ticket id (prevents “created but id blank”)
      if (CFG_B.PIPELINE.AUTO_BACKFILL_TICKET_ID_FROM_URL && !zdTicketId && zdUrlRaw) {
        const derived = extractTicketIdFromUrl_B_(zdUrlRaw);
        if (derived) {
          setCellIf_B_(sh, r + 1, idx.zendesk_ticket_id, derived);
          zdTicketId = derived;

          if (zdStatus !== "created" && idx.zendesk_status >= 0) {
            setCellIf_B_(sh, r + 1, idx.zendesk_status, "created");
          }
        }
      }

      let skipReason = null;

      if (!bookingId || !slotId) {
        skipReason = "missing_ids";
      } else if (CFG_B.PIPELINE.ONLY_IF_BOOKED && bookingStatus !== "booked") {
        skipReason = `status_${bookingStatus || "empty"}`;
      } else if (zdStatus === "created") {
        // created is authoritative: avoid duplicates
        skipReason = "already_created";
      } else if (zdTicketId) {
        // ✅ ONLY skip when ticket id is a REAL numeric Zendesk ticket id
        skipReason = "has_ticket_id";
      } else if (zdStatus === "failed") {
        skipReason = "status_failed";
      }

      if (skipReason) {
        out.skipped++;
        skipReasons[skipReason] = (skipReasons[skipReason] || 0) + 1;
        continue;
      }

      if (requestsMade > 0 && CFG_B.RATE_LIMIT.BATCH_DELAY_MS > 0) {
        Utilities.sleep(CFG_B.RATE_LIMIT.BATCH_DELAY_MS);
      }

      out.processed++;
      out.attempted++;

      const booking = {
        bookingId,
        slotId,
        requesterEmail: String(safeCell_B_(row, idx.requester_email) || "").trim(),
        requesterName: String(safeCell_B_(row, idx.requester_name) || "").trim(),
        notes: String(safeCell_B_(row, idx.notes) || "").trim(),
        dept: String(safeCell_B_(row, idx.dept) || "").trim(),
        bookedAt: String(safeCell_B_(row, idx.booked_at) || "").trim(),
      };

      const parsed = parseSlotId_B_(slotId);
      const slotString = parsed ? `${parsed.date} ${parsed.start_time}` : slotId;

      logInfo_B_("📋 Processing booking", {
        run_id: runId,
        row: r + 1,
        booking_id: bookingId,
        slot_id: slotId,
        requester: booking.requesterEmail
      });

      const attemptedAt = new Date().toISOString();

      const primary = createZendeskTicketWithRetry_B_(creds, booking, slotString, runId, r + 1);
      requestsMade += primary && primary._requests_made ? primary._requests_made : 1;

      if (primary && primary.created) {
        patchBooking_B_(sh, r + 1, idx, {
          zendesk_status: "created",
          zendesk_ticket_id: primary.ticket_id,
          zendesk_ticket_url: primary.ticket_url,
          zendesk_error_code: "",
          zendesk_error_details: "",
          zendesk_attempted_at: attemptedAt,
        });

        logInfo_B_("✅ Ticket created successfully", {
          run_id: runId,
          booking_id: bookingId,
          ticket_id: primary.ticket_id,
          ticket_url: primary.ticket_url,
        });

        out.created++;
        continue;
      }

      const errCode = (primary && primary.error) ? primary.error : "ZENDESK_TICKET_FAILED";
      const errDetails = (primary && primary.details) ? primary.details : "";

      patchBooking_B_(sh, r + 1, idx, {
        zendesk_status: "failed",
        zendesk_error_code: errCode,
        zendesk_error_details: truncate_B_(errDetails, 45000),
        zendesk_attempted_at: attemptedAt,
      });

      logError_B_("❌ Primary ticket creation failed", {
        run_id: runId,
        row: r + 1,
        booking_id: bookingId,
        error_code: errCode,
        error_details_preview: truncate_B_(errDetails, 700),
      });

      const alert = createUrgentAlertTicket_B_(creds, {
        error_code: errCode,
        booking_id: bookingId,
        slot_id: slotId,
        requester_email: booking.requesterEmail,
        requester_name: booking.requesterName,
        error_details: errDetails,
        booking_notes: booking.notes,
        booking_dept: booking.dept,
        booking_booked_at: booking.bookedAt
      }, runId, r + 1);

      if (alert && alert.created) {
        patchBooking_B_(sh, r + 1, idx, {
          alert_ticket_id: alert.ticket_id,
          alert_ticket_url: alert.ticket_url,
        });

        logInfo_B_("🚨 URGENT alert ticket created", {
          run_id: runId,
          booking_id: bookingId,
          alert_ticket_id: alert.ticket_id,
          alert_ticket_url: alert.ticket_url
        });
      }

      out.failed++;

    } catch (rowErr) {
      out.failed++;
      logError_B_("💥 Row processing exception", {
        run_id: runId,
        row: r + 1,
        error: String(rowErr),
        stack: rowErr && rowErr.stack ? rowErr.stack : ""
      });
    }
  }

  const summary = {
    ...out,
    skip_reasons: skipReasons,
    requests_made: requestsMade,
    took_ms: Date.now() - startedAt
  };

  logInfo_B_("🏁 Pipeline run complete", summary);
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}


/* =========================
 * ZENDESK CREDS (✅ Properties override hardcoded)
 * ========================= */
function getZendeskCreds_B_() {
  const p = PropertiesService.getScriptProperties();

  // ✅ Properties FIRST, then fall back to hardcoded defaults
  const subdomain = (p.getProperty(CFG_B.ZENDESK.SUBDOMAIN_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_SUBDOMAIN || "").trim();
  const email = (p.getProperty(CFG_B.ZENDESK.EMAIL_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_EMAIL || "").trim();
  const token = (p.getProperty(CFG_B.ZENDESK.TOKEN_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_TOKEN || "").trim();

  const brandId = (p.getProperty(CFG_B.ZENDESK.BRAND_ID_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_BRAND_ID || "").trim();
  const formId = (p.getProperty(CFG_B.ZENDESK.FORM_ID_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_FORM_ID || "").trim();

  const alertFormId = (p.getProperty(CFG_B.ZENDESK.ALERT_FORM_ID_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_ALERT_FORM_ID || "").trim();
  const alertRequesterEmail = (p.getProperty(CFG_B.ZENDESK.ALERT_REQUESTER_EMAIL_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_ALERT_REQUESTER_EMAIL || "").trim();

  const errorEmailTo = (p.getProperty(CFG_B.ZENDESK.ERROR_EMAIL_TO_PROP) || "").trim() || (CFG_B.ZENDESK.HARDCODED_ERROR_EMAIL_TO || "").trim();

  return { subdomain, email, token, brandId, formId, alertFormId, alertRequesterEmail, errorEmailTo };
}


/* =========================
 * ZENDESK API
 * ========================= */

function createZendeskTicketWithRetry_B_(creds, booking, slotString, runId, rowNum) {
  const max = CFG_B.PIPELINE.MAX_RETRIES;
  let attempts = 0;
  let last = null;
  let requests = 0;

  while (attempts < max) {
    attempts++;
    const res = createZendeskTicket_B_(creds, booking, slotString, runId, rowNum);
    requests++;

    if (res && res.created) {
      res._requests_made = requests;
      return res;
    }

    last = res;

    const code = (res && res.http_code) ? res.http_code : 0;
    const shouldRetry =
      (code === 429) ||
      (code >= 500 && code <= 599) ||
      (res && res.error === "EXCEPTION");

    if (!shouldRetry) break;

    const waitMs = computeBackoffMs_B_(attempts, res && res.retry_after_seconds ? res.retry_after_seconds : 0);
    logWarn_B_("⏳ Zendesk retry backoff", {
      run_id: runId,
      row: rowNum,
      booking_id: booking.bookingId,
      attempt: attempts,
      wait_ms: waitMs,
      error: res ? res.error : "(no response)",
      http_code: code
    });
    Utilities.sleep(waitMs);
  }

  if (last) last._requests_made = requests;
  return last || { created: false, error: "UNKNOWN", details: "No response from createZendeskTicket" };
}

function computeBackoffMs_B_(attempt, retryAfterSeconds) {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(60000, retryAfterSeconds * 1000);
  }
  const base = CFG_B.PIPELINE.RETRY_WAIT_MS_BASE;
  const pow = Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(60000, (base * pow) + jitter);
}

function createZendeskTicket_B_(creds, booking, slotString, runId, rowNum) {
  if (!creds.subdomain || !creds.email || !creds.token) {
    return { created: false, error: "ZENDESK_NOT_CONFIGURED", details: "Missing subdomain, email, or token" };
  }

  const requesterEmail = (booking.requesterEmail || creds.email || "").trim();
  const requesterName = (booking.requesterName || requesterEmail || "Training Booker").trim();

  const subject = `Training Room Booking — ${slotString}`;

  // ✅ Enforced tags for your View
  const deptTag = booking.dept ? ("dept-" + slugifyTag_B_(booking.dept)) : "";
  const tags = uniqueTags_B_(
    []
      .concat(CFG_B.TAGS.REQUIRED)
      .concat(CFG_B.TAGS.DEFAULT)
      .concat(deptTag ? [deptTag] : [])
  );

  const ticket = {
    subject,
    requester: {
      email: requesterEmail,
      name: requesterName,
    },
    comment: {
      body:
        `Training Room Booking Confirmation\n` +
        `=====================================\n\n` +
        `Booking Reference: ${booking.bookingId}\n` +
        `Session: ${slotString}\n` +
        `Requester: ${requesterName} (${requesterEmail})\n` +
        `Department: ${booking.dept || "All"}\n` +
        `Booked At: ${booking.bookedAt || ""}\n\n` +
        (booking.notes ? `Notes:\n${booking.notes}\n\n` : "") +
        `---\n` +
        `This ticket was auto-created via Training Room Booking API`,
    },
    tags,              // ✅ This is what your View filters on
    status: "open",
    custom_fields: [
      { id: CFG_B.ZENDESK.CUSTOM_FIELD_BOOKING_ID, value: booking.bookingId }
    ]
  };

  if (creds.brandId) ticket.brand_id = Number(creds.brandId);
  if (creds.formId) ticket.ticket_form_id = Number(creds.formId);

  const url = `https://${creds.subdomain}.zendesk.com/api/v2/tickets.json`;
  const auth = Utilities.base64Encode(`${creds.email}/token:${creds.token}`);

  if (CFG_B.DEBUG_MODE) {
    logInfo_B_("🔧 Creating Zendesk ticket", {
      run_id: runId,
      row: rowNum,
      booking_id: booking.bookingId,
      url,
      requester_email: requesterEmail,
      tags,
      brand_id: creds.brandId || "",
      form_id: creds.formId || ""
    });
  }

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ ticket }),
    headers: { Authorization: "Basic " + auth },
    muteHttpExceptions: true,
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const httpCode = res.getResponseCode();
    const text = res.getContentText() || "{}";

    const retryAfter = getRetryAfterSeconds_B_(res);

    if (CFG_B.DEBUG_MODE) {
      logInfo_B_("📡 Zendesk API response", {
        run_id: runId,
        row: rowNum,
        booking_id: booking.bookingId,
        http_code: httpCode,
        retry_after_seconds: retryAfter || 0,
        response_preview: truncate_B_(text, 400)
      });
    }

    let parsed = {};
    try { parsed = JSON.parse(text); } catch (e) {}

    if (httpCode >= 200 && httpCode < 300) {
      const ticketId = parsed.ticket && parsed.ticket.id ? String(parsed.ticket.id) : "";
      return {
        created: true,
        ticket_id: ticketId,
        ticket_url: ticketId ? `https://${creds.subdomain}.zendesk.com/agent/tickets/${ticketId}` : "",
        http_code: httpCode
      };
    }

    return {
      created: false,
      error: `ZENDESK_API_${httpCode}`,
      details: text,
      http_code: httpCode,
      retry_after_seconds: retryAfter
    };

  } catch (err) {
    logError_B_("💥 Zendesk API exception", {
      run_id: runId,
      row: rowNum,
      booking_id: booking.bookingId,
      error: String(err),
      stack: err && err.stack ? err.stack : ""
    });
    return { created: false, error: "EXCEPTION", details: String(err), http_code: 0 };
  }
}

function getRetryAfterSeconds_B_(httpResponse) {
  try {
    const headers = httpResponse.getAllHeaders ? httpResponse.getAllHeaders() : null;
    if (!headers) return 0;
    const key = Object.keys(headers).find(k => String(k).toLowerCase() === "retry-after");
    if (!key) return 0;
    const v = parseInt(headers[key], 10);
    return isNaN(v) ? 0 : v;
  } catch (e) {
    return 0;
  }
}

function createUrgentAlertTicket_B_(creds, context, runId, rowNum) {
  if (!creds.subdomain || !creds.email || !creds.token) {
    return { created: false, error: "ZENDESK_NOT_CONFIGURED" };
  }

  const requesterEmail = (creds.alertRequesterEmail || creds.email || "").trim();
  const subject = `🚨 URGENT: Training booking failed - ${context.booking_id}`;

  // ✅ Keep the same REQUIRED tag so your View can also catch alerts if you want
  const tags = uniqueTags_B_(
    []
      .concat(CFG_B.TAGS.REQUIRED)
      .concat(["booking-error", "automated-alert", "urgent"])
  );

  const ticket = {
    subject,
    requester: { email: requesterEmail, name: "Training Booking Monitor" },
    comment: {
      body:
        `⚠️ URGENT: Training Room Booking Ticket Creation Failed\n` +
        `=========================================================\n\n` +
        `A training room booking could not be processed automatically.\n` +
        `IMMEDIATE ACTION REQUIRED: Please create a manual ticket.\n\n` +
        `--- Booking Details ---\n` +
        `Booking ID: ${context.booking_id || "N/A"}\n` +
        `Slot ID: ${context.slot_id || "N/A"}\n` +
        `Requester: ${context.requester_name || "N/A"} <${context.requester_email || "N/A"}>\n` +
        `Department: ${context.booking_dept || "N/A"}\n` +
        `Booked At: ${context.booking_booked_at || "N/A"}\n` +
        `Notes: ${context.booking_notes || "None"}\n\n` +
        `--- Error Information ---\n` +
        `Error Code: ${context.error_code || "UNKNOWN"}\n` +
        `Error Details:\n${context.error_details || "No details available"}\n\n` +
        `Timestamp: ${new Date().toISOString()}\n` +
        `Source: Training Booking Automation (Script B)`,
    },
    tags,
    priority: "urgent",
    status: "open",
    type: "incident"
  };

  if (creds.alertFormId) ticket.ticket_form_id = Number(creds.alertFormId);
  if (creds.brandId) ticket.brand_id = Number(creds.brandId);

  const url = `https://${creds.subdomain}.zendesk.com/api/v2/tickets.json`;
  const auth = Utilities.base64Encode(`${creds.email}/token:${creds.token}`);

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ ticket }),
    headers: { Authorization: "Basic " + auth },
    muteHttpExceptions: true,
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const httpCode = res.getResponseCode();
    const text = res.getContentText() || "{}";

    let parsed = {};
    try { parsed = JSON.parse(text); } catch (e) {}

    if (httpCode >= 200 && httpCode < 300) {
      const ticketId = parsed.ticket && parsed.ticket.id ? String(parsed.ticket.id) : "";
      return {
        created: true,
        ticket_id: ticketId,
        ticket_url: ticketId ? `https://${creds.subdomain}.zendesk.com/agent/tickets/${ticketId}` : "",
        http_code: httpCode
      };
    }

    return { created: false, error: `ZENDESK_API_${httpCode}`, details: text, http_code: httpCode };

  } catch (err) {
    logError_B_("💥 Alert ticket exception", {
      run_id: runId,
      row: rowNum,
      booking_id: context.booking_id,
      error: String(err),
      stack: err && err.stack ? err.stack : ""
    });
    return { created: false, error: "EXCEPTION", details: String(err), http_code: 0 };
  }
}


/* =========================
 * MANUAL TESTS
 * ========================= */

function testZendeskTicket() {
  const runId = makeRunId_B_();
  const creds = getZendeskCreds_B_();

  const testBooking = {
    bookingId: "TEST_" + Date.now(),
    slotId: "SLOT_2026-01-15_1000",
    requesterEmail: creds.email,
    requesterName: "Test User",
    notes: "This is a test booking created by testZendeskTicket()",
    dept: "IT",
    bookedAt: new Date().toISOString()
  };

  logInfo_B_("🧪 Creating test Zendesk ticket", {
    run_id: runId,
    booking_id: testBooking.bookingId,
    requester: testBooking.requesterEmail
  });

  const result = createZendeskTicketWithRetry_B_(creds, testBooking, "2026-01-15 10:00", runId, -1);
  Logger.log(JSON.stringify(result, null, 2));

  if (result.created) return "SUCCESS: Ticket #" + result.ticket_id + " created - " + result.ticket_url;
  return "FAILED: " + result.error + " - " + truncate_B_(result.details || "", 300);
}


/* =========================
 * SHEET ACCESS / HELPERS
 * ========================= */

function getSS_B_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(CFG_B.SHEET_ID_PROP);
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheetWithHeader_B_(ss, name, headerRow) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headerRow.length);
  }
  return sh;
}

function ensureColumns_B_(sheet, cols) {
  const headerWidth = sheet.getLastColumn();
  const header = headerWidth
    ? sheet.getRange(1, 1, 1, headerWidth).getValues()[0].map(h => String(h || "").trim())
    : [];

  const headerLower = header.map(h => h.toLowerCase());
  const missing = cols.filter(c => headerLower.indexOf(String(c).toLowerCase()) < 0);

  if (missing.length) {
    const startCol = header.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.autoResizeColumns(1, header.length + missing.length);
  }
}

function patchBooking_B_(sheet, rowNum, idx, patch) {
  setCellIf_B_(sheet, rowNum, idx.zendesk_status, patch.zendesk_status);
  setCellIf_B_(sheet, rowNum, idx.zendesk_ticket_id, patch.zendesk_ticket_id);
  setCellIf_B_(sheet, rowNum, idx.zendesk_ticket_url, patch.zendesk_ticket_url);
  setCellIf_B_(sheet, rowNum, idx.zendesk_error_code, patch.zendesk_error_code);
  setCellIf_B_(sheet, rowNum, idx.zendesk_error_details, patch.zendesk_error_details);
  setCellIf_B_(sheet, rowNum, idx.zendesk_attempted_at, patch.zendesk_attempted_at);
  setCellIf_B_(sheet, rowNum, idx.alert_ticket_id, patch.alert_ticket_id);
  setCellIf_B_(sheet, rowNum, idx.alert_ticket_url, patch.alert_ticket_url);

  // optional
  setCellIf_B_(sheet, rowNum, idx.debug_json, patch.debug_json);
}

function setCellIf_B_(sheet, rowNum, colIdx, value) {
  if (colIdx === undefined || colIdx === null || colIdx < 0) return;
  if (value === undefined) return;
  sheet.getRange(rowNum, colIdx + 1).setValue(value);
}


/* =========================
 * MAPPING / PARSING
 * ========================= */

function indexMap_B_(header) {
  const m = {};
  for (let i = 0; i < header.length; i++) {
    const key = String(header[i] || "").trim().toLowerCase();
    if (!key) continue;
    m[key] = i;
  }

  return {
    booking_id: m["booking_id"] !== undefined ? m["booking_id"] : -1,
    slot_id: m["slot_id"] !== undefined ? m["slot_id"] : -1,
    booking_status: m["booking_status"] !== undefined ? m["booking_status"] : -1,
    fail_code: m["fail_code"] !== undefined ? m["fail_code"] : -1,
    requester_email: m["requester_email"] !== undefined ? m["requester_email"] : -1,
    requester_name: m["requester_name"] !== undefined ? m["requester_name"] : -1,
    attendees: m["attendees"] !== undefined ? m["attendees"] : -1,
    notes: m["notes"] !== undefined ? m["notes"] : -1,
    dept: m["dept"] !== undefined ? m["dept"] : -1,
    booked_at: m["booked_at"] !== undefined ? m["booked_at"] : -1,
    debug_json: m["debug_json"] !== undefined ? m["debug_json"] : -1,

    zendesk_status: m["zendesk_status"] !== undefined ? m["zendesk_status"] : -1,
    zendesk_ticket_id: m["zendesk_ticket_id"] !== undefined ? m["zendesk_ticket_id"] : -1,
    zendesk_ticket_url: m["zendesk_ticket_url"] !== undefined ? m["zendesk_ticket_url"] : -1,
    zendesk_error_code: m["zendesk_error_code"] !== undefined ? m["zendesk_error_code"] : -1,
    zendesk_error_details: m["zendesk_error_details"] !== undefined ? m["zendesk_error_details"] : -1,
    zendesk_attempted_at: m["zendesk_attempted_at"] !== undefined ? m["zendesk_attempted_at"] : -1,
    alert_ticket_id: m["alert_ticket_id"] !== undefined ? m["alert_ticket_id"] : -1,
    alert_ticket_url: m["alert_ticket_url"] !== undefined ? m["alert_ticket_url"] : -1,
  };
}

function listMissingRequiredCols_B_(idx) {
  const required = [
    "booking_id",
    "slot_id",
    "booking_status",
    "requester_email",
    "requester_name",
    "notes",
    "dept",
    "booked_at",
    "zendesk_status",
    "zendesk_ticket_id"
  ];

  const missing = [];
  required.forEach(k => {
    if (idx[k] === undefined || idx[k] === null || idx[k] < 0) missing.push(k);
  });
  return missing;
}

function safeCell_B_(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return "";
  return row[idx];
}

function parseSlotId_B_(slotId) {
  const s = String(slotId || "").trim().toUpperCase();
  const m = s.match(/^SLOT_(\d{4}-\d{2}-\d{2})_(\d{4})$/);
  if (!m) return null;
  const date = m[1];
  const hhmm = m[2];
  const start_time = hhmm.slice(0, 2) + ":" + hhmm.slice(2, 4);
  return { date, start_time };
}

// ✅ NEW: ticket-id helpers
function isValidTicketId_B_(v) {
  const s = String(v || "").trim();
  return /^\d+$/.test(s);
}

function looksLikeJson_B_(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  if (!(s.startsWith("{") || s.startsWith("["))) return false;
  // quick sanity
  return (s.includes('"') || s.includes(":") || s.includes("session") || s.includes("slot_id"));
}

function normalizeZendeskTicketId_B_(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ticket_id: "", is_json: false, json_text: "" };
  if (isValidTicketId_B_(s)) return { ticket_id: s, is_json: false, json_text: "" };
  if (looksLikeJson_B_(s)) return { ticket_id: "", is_json: true, json_text: s };
  return { ticket_id: "", is_json: false, json_text: "" };
}

function extractTicketIdFromUrl_B_(url) {
  const s = String(url || "").trim();
  const m = s.match(/\/tickets\/(\d+)(\b|\/|\?)/i);
  return m && m[1] ? m[1] : "";
}

// ✅ NEW: tag utilities
function slugifyTag_B_(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function uniqueTags_B_(tags) {
  const seen = {};
  const out = [];
  (tags || []).forEach(t => {
    const tt = slugifyTag_B_(t);
    if (!tt) return;
    if (seen[tt]) return;
    seen[tt] = true;
    out.push(tt);
  });
  return out;
}


/* =========================
 * LOGGING
 * ========================= */
function logInfo_B_(message, meta) { appendLog_B_("INFO", message, meta); }
function logWarn_B_(message, meta) { appendLog_B_("WARN", message, meta); }
function logError_B_(message, meta) { appendLog_B_("ERROR", message, meta); }

function appendLog_B_(level, message, meta) {
  try {
    const ss = getSS_B_();
    const sh = ss.getSheetByName(CFG_B.SHEETS.LOGS) || ensureSheetWithHeader_B_(ss, CFG_B.SHEETS.LOGS, [
      "timestamp",
      "level",
      "message",
      "meta_json",
    ]);

    sh.appendRow([
      new Date().toISOString(),
      level,
      message,
      JSON.stringify(meta || {}),
    ]);
  } catch (e) {}
}


/* =========================
 * SMALL UTILS
 * ========================= */
function lower_B_(v) { return String(v || "").trim().toLowerCase(); }

function truncate_B_(s, maxLen) {
  s = String(s || "");
  if (!maxLen || s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

function makeRunId_B_() {
  return "run_" + Utilities.getUuid().split("-")[0] + "_" + Date.now();
}


/* =========================
 * OPTIONAL: Process single booking by ID (✅ fixed)
 * ========================= */
function processOneBooking(bookingId) {
  const runId = makeRunId_B_();
  if (!bookingId) {
    Logger.log("Usage: processOneBooking('book_xxx_12345')");
    return { error: "MISSING_BOOKING_ID", run_id: runId };
  }

  const ss = getSS_B_();
  const sh = ss.getSheetByName(CFG_B.SHEETS.BOOKINGS);
  if (!sh) throw new Error("BOOKINGS sheet not found.");

  ensureColumns_B_(sh, [
    "zendesk_status",
    "zendesk_ticket_id",
    "zendesk_ticket_url",
    "zendesk_error_code",
    "zendesk_error_details",
    "zendesk_attempted_at",
    "alert_ticket_id",
    "alert_ticket_url",
  ]);

  const values = sh.getDataRange().getValues();
  const header = values[0].map(h => String(h || "").trim());
  const idx = indexMap_B_(header);

  const missingRequired = listMissingRequiredCols_B_(idx);
  if (missingRequired.length) {
    logError_B_("❌ Missing required columns (cannot processOneBooking)", { run_id: runId, missing: missingRequired });
    return { error: "MISSING_REQUIRED_COLUMNS", missing: missingRequired, run_id: runId };
  }

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(safeCell_B_(row, idx.booking_id)).trim() === bookingId) {
      const creds = getZendeskCreds_B_();

      const booking = {
        bookingId: String(safeCell_B_(row, idx.booking_id)).trim(),
        slotId: String(safeCell_B_(row, idx.slot_id)).trim(),
        requesterEmail: String(safeCell_B_(row, idx.requester_email)).trim(),
        requesterName: String(safeCell_B_(row, idx.requester_name)).trim(),
        notes: String(safeCell_B_(row, idx.notes)).trim(),
        dept: String(safeCell_B_(row, idx.dept)).trim(),
        bookedAt: String(safeCell_B_(row, idx.booked_at)).trim(),
      };

      const parsed = parseSlotId_B_(booking.slotId);
      const slotString = parsed ? `${parsed.date} ${parsed.start_time}` : booking.slotId;

      const attemptedAt = new Date().toISOString();
      const result = createZendeskTicketWithRetry_B_(creds, booking, slotString, runId, r + 1);

      if (result && result.created) {
        patchBooking_B_(sh, r + 1, idx, {
          zendesk_status: "created",
          zendesk_ticket_id: result.ticket_id,
          zendesk_ticket_url: result.ticket_url,
          zendesk_attempted_at: attemptedAt,
          zendesk_error_code: "",
          zendesk_error_details: ""
        });
      } else {
        patchBooking_B_(sh, r + 1, idx, {
          zendesk_status: "failed",
          zendesk_attempted_at: attemptedAt,
          zendesk_error_code: result ? result.error : "UNKNOWN",
          zendesk_error_details: truncate_B_(result ? (result.details || "") : "No details", 45000)
        });
      }

      Logger.log(JSON.stringify({ run_id: runId, result }, null, 2));
      return { run_id: runId, result };
    }
  }

  return { error: "NOT_FOUND", run_id: runId };
}
