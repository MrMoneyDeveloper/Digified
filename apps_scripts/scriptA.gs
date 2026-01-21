// Reference-only stub.
// The live Apps Script project is deployed outside this repo.
// Do not edit or deploy from here. See README.md in this folder.

/************************************************************
 * Script A — Training Booking API (Google Apps Script Web App)
 * ----------------------------------------------------------
 * CLEAN: 2025-12-31
 *
 * ✅ Dynamic sessions (Mon–Fri, 08:00–00:00 midnight, 60min)
 * ✅ JSONP supported for ALL GET endpoints (sessions/days/health/book/get_api_key)
 * ✅ Booking supports GET (JSONP) to avoid Zendesk HC CORS restrictions
 * ✅ POST supported (book/cancel) for same-origin / server-to-server
 * ✅ API key auth required for everything except init + get_api_key
 * ✅ SESSIONS sheet is OPTIONAL overrides (cancel slot / change fields / capacity / manual reserve)
 *
 * UI alignment:
 * ✅ "vendor" field is repurposed as "Reserved By" for back-compat:
 *    - If slot booked → vendor returns latest requester_name/email
 *    - If not booked → vendor returns override vendor (manual reserve) OR blank
 *
 * What Script A DOES NOT DO:
 * ❌ No Zendesk tickets
 * ❌ No pipeline
 * ❌ No triggers
 ************************************************************/

const CFG = {
  DEPLOYMENT: {
    ID: "AKfycbxKZUHO8KiN6-oawtgTnXJy9yf2OPUT1hpnRgcrnygAB8SzMv3J5EylrhC4_Dgv0_dX",
    WEBAPP_URL:
      "https://script.google.com/macros/s/AKfycbxKZUHO8KiN6-oawtgTnXJy9yf2OPUT1hpnRgcrnygAB8SzMv3J5EylrhC4_Dgv0_dX/exec",
  },

  SHEETS: {
    SESSIONS: "SESSIONS", // optional overrides
    BOOKINGS: "BOOKINGS",
    SETTINGS: "SETTINGS",
  },

  SHEET_ID_PROP: "TRAINING_SHEET_ID", // optional if standalone
  ALLOW_GET_BOOKING: true,

  DEFAULT_TIMEZONE: Session.getScriptTimeZone() || "Africa/Johannesburg",

  RULES: {
    ENABLED: true,
    WEEKDAYS: [1, 2, 3, 4, 5], // ISO 1=Mon ... 7=Sun
    START_HHMM: "08:00",
    END_HHMM: "00:00", // midnight wrap-around end-of-day
    SLOT_MINUTES: 60,

    DEFAULT_RESERVED_BY: "", // vendor (reserved by) override default
    DEFAULT_TOPIC: "Training Session",
    DEFAULT_DEPT: "All",
    DEFAULT_CAPACITY: 1,

    SLOT_ID_PREFIX: "SLOT_",
  },
};

/**
 * ===== PUBLIC: HTTP Entrypoints =====
 */
function doGet(e) {
  const requestId = makeId_("req");
  const started = Date.now();

  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = (params.action || "sessions").toLowerCase();

    // init + get_api_key are open (bootstrapping)
    if (action !== "init" && action !== "get_api_key") requireApiKey_(e, requestId);

    let result;

    if (action === "init") {
      result = handleInit_(requestId, params);

    } else if (action === "get_api_key") {
      result = handleGetApiKey_(requestId);

    } else if (action === "sessions") {
      result = handleSessions_(params, requestId);

    } else if (action === "days") {
      result = handleDays_(params, requestId);

    } else if (action === "book") {
      if (!CFG.ALLOW_GET_BOOKING) {
        result = fail_(requestId, "GET_BOOKING_DISABLED", "Booking via GET is disabled.", 403);
      } else {
        result = handleBook_(
          {
            slot_id: params.slot_id,
            requester_email: params.requester_email,
            requester_name: params.requester_name,
            notes: params.notes,
            dept: params.dept,
            user_type: params.user_type,
          },
          requestId
        );
      }

    } else if (action === "health") {
      result = ok_(
        requestId,
        {
          ok: true,
          now: new Date().toISOString(),
          timezone: CFG.DEFAULT_TIMEZONE,
          rules_enabled: CFG.RULES.ENABLED,
          working_hours: `${CFG.RULES.START_HHMM}-${CFG.RULES.END_HHMM}`,
          weekdays: CFG.RULES.WEEKDAYS.join(","),
          allow_get_booking: CFG.ALLOW_GET_BOOKING,
        },
        "Health OK"
      );

    } else {
      result = fail_(requestId, "UNKNOWN_ACTION", "Unknown action: " + action, 400);
    }

    result.meta = { request_id: requestId, took_ms: Date.now() - started, tz: CFG.DEFAULT_TIMEZONE };
    return jsonResponse_(result, e);

  } catch (err) {
    const payload = errorPayload_(requestId, "UNHANDLED_GET_ERROR", err);
    payload.meta = { request_id: requestId, took_ms: Date.now() - started };
    return jsonResponse_(payload, e);
  }
}

function doPost(e) {
  const requestId = makeId_("req");
  const started = Date.now();

  try {
    requireApiKey_(e, requestId);

    const body = parseBody_(e);
    const action = (body.action || "").toLowerCase();

    let result;
    if (action === "book") {
      result = handleBook_(body, requestId);
    } else if (action === "cancel") {
      result = handleCancel_(body, requestId);
    } else {
      result = fail_(requestId, "UNKNOWN_ACTION", "Unknown action: " + action, 400);
    }

    result.meta = { request_id: requestId, took_ms: Date.now() - started, tz: CFG.DEFAULT_TIMEZONE };
    return jsonResponse_(result, e);

  } catch (err) {
    const payload = errorPayload_(requestId, "UNHANDLED_POST_ERROR", err);
    payload.meta = { request_id: requestId, took_ms: Date.now() - started };
    return jsonResponse_(payload, e);
  }
}

/**
 * ===== SPREADSHEET ACCESS =====
 */
function getSS_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(CFG.SHEET_ID_PROP);
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * ===== INIT =====
 */
function handleInit_(requestId, params) {
  const ss = getSS_();

  // SESSIONS = optional overrides (vendor = manual reserve)
  ensureSheetWithHeader_(ss, CFG.SHEETS.SESSIONS, [
    "slot_id",
    "date",
    "start_time",
    "end_time",
    "vendor",      // Reserved By (manual override)
    "topic",
    "dept",
    "capacity",
    "status",      // open / cancelled
    "created_at",
    "updated_at",
  ]);

  ensureSheetWithHeader_(ss, CFG.SHEETS.BOOKINGS, [
    "booking_id",
    "slot_id",
    "booking_status",   // booked / failed / cancelled
    "fail_code",
    "requester_email",
    "requester_name",
    "attendees",        // kept for compatibility; always forced to 1
    "notes",
    "dept",
    "booked_at",
    "debug_json",
  ]);

  ensureSheetWithHeader_(ss, CFG.SHEETS.SETTINGS, ["key", "value", "updated_at"]);

  // API key generate/rotate
  const props = PropertiesService.getScriptProperties();
  const rotate = String((params && params.rotate_key) ? params.rotate_key : "").trim() === "1";

  let apiKey = props.getProperty("TRAINING_API_KEY");
  if (!apiKey || rotate) {
    apiKey = Utilities.getUuid().replace(/-/g, "");
    props.setProperty("TRAINING_API_KEY", apiKey);
  }

  // Store settings in sheet (for visibility)
  upsertSetting_(ss, "DEPLOYMENT_ID", CFG.DEPLOYMENT.ID);
  upsertSetting_(ss, "WEBAPP_URL", CFG.DEPLOYMENT.WEBAPP_URL);
  upsertSetting_(ss, "TRAINING_API_KEY", apiKey);
  upsertSetting_(ss, "TIMEZONE", CFG.DEFAULT_TIMEZONE);
  upsertSetting_(ss, "ALLOW_GET_BOOKING", String(CFG.ALLOW_GET_BOOKING));
  upsertSetting_(ss, "RULES_ENABLED", String(CFG.RULES.ENABLED));
  upsertSetting_(ss, "WORKING_HOURS", `${CFG.RULES.START_HHMM}-${CFG.RULES.END_HHMM}`);
  upsertSetting_(ss, "WORKING_WEEKDAYS", CFG.RULES.WEEKDAYS.join(","));
  upsertSetting_(ss, "SLOT_MINUTES", String(CFG.RULES.SLOT_MINUTES));

  return ok_(
    requestId,
    {
      sheets_ready: true,
      api_key: apiKey,
      webapp_url: CFG.DEPLOYMENT.WEBAPP_URL,
      rules: {
        enabled: CFG.RULES.ENABLED,
        weekdays: CFG.RULES.WEEKDAYS,
        working_hours: `${CFG.RULES.START_HHMM}-${CFG.RULES.END_HHMM}`,
        slot_minutes: CFG.RULES.SLOT_MINUTES,
        example_slot_id: buildSlotId_("2026-01-15", "08:00"),
        note: "END_HHMM=00:00 means midnight (wrap-around end-of-day).",
      },
      next_steps: [
        "1) Test sessions: ?action=sessions&from=2026-01-01&to=2026-01-31&api_key=YOUR_KEY",
        "2) Book via JSONP GET: ?action=book&slot_id=SLOT_...&requester_email=...&api_key=...&callback=cb",
        "3) Optional overrides: add a row to SESSIONS to cancel/change a specific slot",
      ],
    },
    rotate ? "Init complete - API key rotated" : "Init complete - API key ready"
  );
}

/**
 * ===== GET API KEY (masked) =====
 */
function handleGetApiKey_(requestId) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("TRAINING_API_KEY");

  if (!apiKey) {
    return fail_(requestId, "NO_API_KEY", "No API key found. Run ?action=init first.", 404, {
      hint: "Visit: " + CFG.DEPLOYMENT.WEBAPP_URL + "?action=init",
    });
  }

  return ok_(
    requestId,
    {
      api_key_masked: mask_(apiKey),
      api_key_length: apiKey.length,
      test_url: CFG.DEPLOYMENT.WEBAPP_URL + "?action=health&api_key=" + apiKey,
    },
    "API key info retrieved"
  );
}

/**
 * ===== SESSIONS LISTING (DYNAMIC) =====
 * GET ?action=sessions&from=YYYY-MM-DD&to=YYYY-MM-DD&api_key=...
 */
function handleSessions_(params, requestId) {
  const from = (params.from || "").trim();
  const to = (params.to || "").trim();

  const today = formatDate_(new Date());
  const fromDate = isDateStr_(from) ? from : today;
  const toDate = isDateStr_(to) ? to : formatDate_(addDays_(new Date(), 30));

  const ss = getSS_();

  // 1) Rule-based slots
  const slots = generateSlots_(fromDate, toDate);

  // 2) Overrides (SESSIONS)
  const overrides = readSessionsAsOverrideMap_(ss);

  // 3) Merge + compute availability from BOOKINGS
  const sessions = slots.map(s => {
    const o = overrides[s.slot_id] || null;

    const merged = {
      slot_id: s.slot_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      vendor: (o && o.vendor) ? String(o.vendor).trim() : s.vendor, // manual reserve (optional)
      topic: (o && o.topic) ? String(o.topic).trim() : s.topic,
      dept: (o && o.dept) ? String(o.dept).trim() : s.dept,
      capacity: (o && toInt_(o.capacity, 0)) ? toInt_(o.capacity, 0) : s.capacity,
      status: (o && o.status) ? String(o.status).toLowerCase() : "open",
    };

    const bookedCount = countBookedForSlot_(ss, merged.slot_id);
    const cap = toInt_(merged.capacity, 0);
    const isFull = cap > 0 && bookedCount >= cap;
    const isCancelled = String(merged.status || "open").toLowerCase() === "cancelled";

    // vendor output = reserved by (latest booker if booked, else manual reserve if any)
    const latestBooker = bookedCount > 0 ? getLatestBookerNameForSlot_(ss, merged.slot_id) : "";
    const reservedBy = latestBooker ? latestBooker : (merged.vendor || "");

    return {
      slot_id: merged.slot_id,
      date: merged.date,
      start_time: merged.start_time,
      end_time: merged.end_time,

      vendor: reservedBy,         // back-compat
      reserved_by: reservedBy,    // explicit for new UI

      topic: merged.topic,
      dept: merged.dept,
      capacity: cap,
      booked_count: bookedCount,
      available: (!isCancelled) && (!isFull),
      status: isCancelled ? "cancelled" : (isFull ? "full" : "open"),
    };
  });

  return ok_(
    requestId,
    { from: fromDate, to: toDate, total_sessions: sessions.length, sessions },
    "Sessions loaded"
  );
}

/**
 * ===== DAYS (CALENDAR SUMMARY) =====
 * GET ?action=days&from=YYYY-MM-DD&to=YYYY-MM-DD&api_key=...
 */
function handleDays_(params, requestId) {
  const from = (params.from || "").trim();
  const to = (params.to || "").trim();

  const today = formatDate_(new Date());
  const fromDate = isDateStr_(from) ? from : today;
  const toDate = isDateStr_(to) ? to : formatDate_(addDays_(new Date(), 30));

  const slots = generateSlots_(fromDate, toDate);

  const dayMap = {};
  slots.forEach(s => dayMap[s.date] = (dayMap[s.date] || 0) + 1);

  const days = Object.keys(dayMap).sort().map(d => ({ date: d, count: dayMap[d] }));

  return ok_(requestId, { from: fromDate, to: toDate, total_days: days.length, days }, "Days loaded");
}

/**
 * ===== BOOKING =====
 * POST { action:"book", slot_id, requester_email, requester_name, notes, dept, user_type }
 * GET  ?action=book&slot_id=...&requester_email=...&api_key=...&callback=cb
 */
function handleBook_(body, requestId) {
  const slotId = (body.slot_id || "").trim();
  const requesterEmail = (body.requester_email || "").trim().toLowerCase();
  const requesterName = (body.requester_name || "").trim();
  const notes = (body.notes || "").toString().trim();
  const dept = (body.dept || "").toString().trim();
  const userType = (body.user_type || "").toString().trim();

  const attendees = 1; // forced

  if (!slotId) return fail_(requestId, "MISSING_SLOT_ID", "slot_id is required", 400);
  if (!requesterEmail) return fail_(requestId, "MISSING_EMAIL", "requester_email is required", 400);

  // Validate slot against rules
  const parsed = parseSlotId_(slotId);
  if (!parsed || !isSlotAllowedByRules_(parsed.date, parsed.start_time)) {
    writeBooking_(getSS_(), buildBookingRow_({
      booking_id: makeId_("book"),
      slot_id: slotId,
      booking_status: "failed",
      fail_code: "FAIL_SLOT_NOT_ALLOWED",
      requester_email: requesterEmail,
      requester_name: requesterName,
      attendees,
      notes,
      dept,
      booked_at: new Date().toISOString(),
      debug_json: JSON.stringify({ reason: "slot not allowed by rules", parsed, user_type: userType }),
    }));
    return fail_(requestId, "FAIL_SLOT_NOT_ALLOWED", "This slot is not within allowed working hours.", 400);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  const ss = getSS_();
  const bookingId = makeId_("book");

  try {
    ensureBookingSheet_(ss);

    // Build session from rules + overrides
    const session = buildSessionFromRulesAndOverrides_(ss, parsed.date, parsed.start_time);
    if (!session) {
      writeBooking_(ss, buildBookingRow_({
        booking_id: bookingId,
        slot_id: slotId,
        booking_status: "failed",
        fail_code: "FAIL_INVALID_SLOT",
        requester_email: requesterEmail,
        requester_name: requesterName,
        attendees,
        notes,
        dept,
        booked_at: new Date().toISOString(),
        debug_json: JSON.stringify({ reason: "could not build session", user_type: userType }),
      }));
      return fail_(requestId, "FAIL_INVALID_SLOT", "Slot not found: " + slotId, 404);
    }

    // Cancelled?
    if (String(session.status || "open").toLowerCase() === "cancelled") {
      writeBooking_(ss, buildBookingRow_({
        booking_id: bookingId,
        slot_id: slotId,
        booking_status: "failed",
        fail_code: "FAIL_CANCELLED",
        requester_email: requesterEmail,
        requester_name: requesterName,
        attendees,
        notes,
        dept,
        booked_at: new Date().toISOString(),
        debug_json: JSON.stringify({ reason: "session cancelled", user_type: userType }),
      }));
      return fail_(requestId, "FAIL_CANCELLED", "This session is cancelled", 409);
    }

    // Duplicate booking by same email for same slot?
    if (hasActiveBookingForEmailAndSlot_(ss, requesterEmail, slotId)) {
      writeBooking_(ss, buildBookingRow_({
        booking_id: bookingId,
        slot_id: slotId,
        booking_status: "failed",
        fail_code: "FAIL_ALREADY_BOOKED",
        requester_email: requesterEmail,
        requester_name: requesterName,
        attendees,
        notes,
        dept,
        booked_at: new Date().toISOString(),
        debug_json: JSON.stringify({ reason: "duplicate booking by same user", user_type: userType }),
      }));
      return fail_(requestId, "FAIL_ALREADY_BOOKED", "You already booked this slot", 409);
    }

    // Capacity check
    const capacity = toInt_(session.capacity, 0);
    const bookedCount = countBookedForSlot_(ss, slotId);
    if (capacity > 0 && bookedCount >= capacity) {
      writeBooking_(ss, buildBookingRow_({
        booking_id: bookingId,
        slot_id: slotId,
        booking_status: "failed",
        fail_code: "FAIL_SLOT_FULL",
        requester_email: requesterEmail,
        requester_name: requesterName,
        attendees,
        notes,
        dept,
        booked_at: new Date().toISOString(),
        debug_json: JSON.stringify({ capacity, bookedCount, user_type: userType }),
      }));
      return fail_(requestId, "FAIL_SLOT_FULL", "This slot is already full", 409, { capacity, bookedCount });
    }

    // Commit booking
    writeBooking_(ss, buildBookingRow_({
      booking_id: bookingId,
      slot_id: slotId,
      booking_status: "booked",
      fail_code: "",
      requester_email: requesterEmail,
      requester_name: requesterName,
      attendees,
      notes,
      dept: dept || session.dept || "",
      booked_at: new Date().toISOString(),
      debug_json: JSON.stringify({ session, user_type: userType }),
    }));

    return ok_(
      requestId,
      {
        booking_id: bookingId,
        slot_id: slotId,
        session: sessionToPublic_(session),
        attendees_forced: 1,
      },
      "Booked successfully"
    );

  } catch (err) {
    writeBooking_(ss, buildBookingRow_({
      booking_id: bookingId,
      slot_id: slotId,
      booking_status: "failed",
      fail_code: "FAIL_SYSTEM_ERROR",
      requester_email: requesterEmail,
      requester_name: requesterName,
      attendees,
      notes,
      dept,
      booked_at: new Date().toISOString(),
      debug_json: JSON.stringify({ error: String(err), stack: err && err.stack ? err.stack : "", user_type: userType }),
    }));
    return errorPayload_(requestId, "FAIL_SYSTEM_ERROR", err);

  } finally {
    lock.releaseLock();
  }
}

/**
 * ===== CANCEL =====
 */
function handleCancel_(body, requestId) {
  const bookingId = (body.booking_id || "").trim();
  if (!bookingId) return fail_(requestId, "MISSING_BOOKING_ID", "booking_id is required", 400);

  const ss = getSS_();
  const ok = markBookingCancelled_(ss, bookingId);

  if (!ok) return fail_(requestId, "NOT_FOUND", "Booking not found: " + bookingId, 404);
  return ok_(requestId, { booking_id: bookingId }, "Booking cancelled");
}

/**
 * ===== SECURITY =====
 */
function requireApiKey_(e, requestId) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty("TRAINING_API_KEY");

  if (!expected) {
    const err = new Error("TRAINING_API_KEY not set. Run GET ?action=init first to generate API key.");
    err.statusCode = 500;
    err.code = "API_KEY_NOT_CONFIGURED";
    throw err;
  }

  const provided =
    (e && e.parameter && e.parameter.api_key ? String(e.parameter.api_key) : "") ||
    getHeader_(e, "x-api-key");

  if (!provided) {
    const err = new Error("API key required. Provide via ?api_key=YOUR_KEY or x-api-key header.");
    err.statusCode = 401;
    err.code = "API_KEY_MISSING";
    throw err;
  }

  if (provided !== expected) {
    const err = new Error("Invalid API key. Use GET ?action=get_api_key to verify.");
    err.statusCode = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
}

/**
 * ===== SHEET HELPERS =====
 */
function ensureSheetWithHeader_(ss, name, headerRow) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  const lastRow = sh.getLastRow();

  if (lastRow === 0) {
    sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headerRow.length);
    return sh;
  }

  // append missing headers if sheet is older
  const existingWidth = sh.getLastColumn();
  const existingHeader = sh.getRange(1, 1, 1, existingWidth).getValues()[0].map(x => String(x || "").trim());

  if (existingHeader.length < headerRow.length) {
    const missing = headerRow.slice(existingHeader.length);
    sh.getRange(1, existingHeader.length + 1, 1, missing.length).setValues([missing]);
    sh.autoResizeColumns(1, headerRow.length);
  }

  return sh;
}

function ensureBookingSheet_(ss) {
  ensureSheetWithHeader_(ss, CFG.SHEETS.BOOKINGS, [
    "booking_id",
    "slot_id",
    "booking_status",
    "fail_code",
    "requester_email",
    "requester_name",
    "attendees",
    "notes",
    "dept",
    "booked_at",
    "debug_json",
  ]);
}

function upsertSetting_(ss, key, value) {
  const sh = ss.getSheetByName(CFG.SHEETS.SETTINGS) ||
    ensureSheetWithHeader_(ss, CFG.SHEETS.SETTINGS, ["key", "value", "updated_at"]);

  const rows = sh.getDataRange().getValues();
  const now = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      sh.getRange(i + 1, 3).setValue(now);
      return;
    }
  }
  sh.appendRow([key, value, now]);
}

/**
 * Overrides map: slot_id -> override object
 */
function readSessionsAsOverrideMap_(ss) {
  const sh = ss.getSheetByName(CFG.SHEETS.SESSIONS);
  if (!sh) return {};

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0].map(h => String(h || "").trim());
  const map = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);

    const norm = normaliseSession_(obj);
    if (!norm.slot_id) continue;

    map[String(norm.slot_id).toUpperCase()] = norm;
  }

  return map;
}

function normaliseSession_(s) {
  const dateStr = normaliseDateValue_(s.date);
  const startStr = normaliseTimeValue_(s.start_time);
  const endStr = normaliseTimeValue_(s.end_time);

  const parsed = parseSlotId_(String(s.slot_id || "").trim());
  const derivedDate = (!dateStr && parsed) ? parsed.date : dateStr;
  const derivedStart = (!startStr && parsed) ? parsed.start_time : startStr;
  const derivedEnd = (!endStr && derivedStart)
    ? addMinutesToHHMM_(derivedStart, CFG.RULES.SLOT_MINUTES)
    : endStr;

  return {
    slot_id: String(s.slot_id || "").trim().toUpperCase(),
    date: String(derivedDate || "").trim(),
    start_time: String(derivedStart || "").trim(),
    end_time: String(derivedEnd || "").trim(),
    vendor: String(s.vendor || "").trim(), // manual reserve (optional)
    topic: String(s.topic || "").trim(),
    dept: String(s.dept || "").trim(),
    capacity: toInt_(s.capacity, 0),
    status: String(s.status || "open").trim().toLowerCase(),
  };
}

function normaliseDateValue_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    return Utilities.formatDate(v, CFG.DEFAULT_TIMEZONE, "yyyy-MM-dd");
  }
  const s = String(v || "").trim();
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, "-");
  return s;
}

function normaliseTimeValue_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    return Utilities.formatDate(v, CFG.DEFAULT_TIMEZONE, "HH:mm");
  }
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return String(m[1]).padStart(2, "0") + ":" + m[2];
  return s;
}

function sessionToPublic_(s) {
  return {
    slot_id: s.slot_id,
    date: s.date,
    start_time: s.start_time,
    end_time: s.end_time,
    vendor: s.vendor || "",          // back-compat reserved by
    reserved_by: s.vendor || "",
    topic: s.topic,
    dept: s.dept,
    capacity: toInt_(s.capacity, 0),
    status: (s.status || "open").toLowerCase(),
  };
}

/**
 * BOOKINGS
 */
function buildBookingRow_(b) {
  return {
    booking_id: b.booking_id || "",
    slot_id: b.slot_id || "",
    booking_status: b.booking_status || "",
    fail_code: b.fail_code || "",
    requester_email: b.requester_email || "",
    requester_name: b.requester_name || "",
    attendees: 1,
    notes: b.notes || "",
    dept: b.dept || "",
    booked_at: b.booked_at || "",
    debug_json: b.debug_json || "",
  };
}

function writeBooking_(ss, booking) {
  ensureBookingSheet_(ss);
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);

  sh.appendRow([
    booking.booking_id || "",
    booking.slot_id || "",
    booking.booking_status || "",
    booking.fail_code || "",
    booking.requester_email || "",
    booking.requester_name || "",
    1,
    booking.notes || "",
    booking.dept || "",
    booking.booked_at || "",
    booking.debug_json || "",
  ]);
}

function markBookingCancelled_(ss, bookingId) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return false;

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return false;

  const header = values[0].map(String);
  const idx = indexMap_(header);

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idx.booking_id] || "") === String(bookingId)) {
      sh.getRange(i + 1, idx.booking_status + 1).setValue("cancelled");
      return true;
    }
  }
  return false;
}

function countBookedForSlot_(ss, slotId) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return 0;

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;

  const header = values[0].map(String);
  const idx = indexMap_(header);

  let count = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowSlot = String(row[idx.slot_id] || "");
    const status = lower_(row[idx.booking_status]);
    if (rowSlot === String(slotId) && status === "booked") count++;
  }
  return count;
}

function hasActiveBookingForEmailAndSlot_(ss, email, slotId) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return false;

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return false;

  const header = values[0].map(String);
  const idx = indexMap_(header);

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowSlot = String(row[idx.slot_id] || "");
    const status = lower_(row[idx.booking_status]);
    const rowEmail = lower_(row[idx.requester_email]);
    if (rowSlot === String(slotId) && status === "booked" && rowEmail === email.toLowerCase()) return true;
  }
  return false;
}

function getLatestBookerNameForSlot_(ss, slotId) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return "";

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return "";

  const header = values[0].map(String);
  const idx = indexMap_(header);

  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    const rowSlot = String(row[idx.slot_id] || "");
    const status = lower_(row[idx.booking_status]);
    if (rowSlot === String(slotId) && status === "booked") {
      const nm = String(row[idx.requester_name] || "").trim();
      return nm || String(row[idx.requester_email] || "").trim();
    }
  }
  return "";
}

/**
 * ===== DYNAMIC SLOT ENGINE =====
 * Supports wrap-around ranges (08:00 → 00:00 midnight)
 */
function generateSlots_(fromDateStr, toDateStr) {
  if (!CFG.RULES.ENABLED) return [];

  const from = parseDate_(fromDateStr);
  const to = parseDate_(toDateStr);

  const startMin = hhmmToMinutes_(CFG.RULES.START_HHMM);
  let endMin = hhmmToMinutes_(CFG.RULES.END_HHMM);
  const slotMin = toInt_(CFG.RULES.SLOT_MINUTES, 60);

  if (endMin <= startMin) endMin += 1440; // wrap

  const out = [];
  let d = new Date(from.getTime());

  while (d <= to) {
    const isoWd = isoWeekday_(d);
    const dateStr = formatDate_(d);

    if (CFG.RULES.WEEKDAYS.indexOf(isoWd) >= 0) {
      for (let m = startMin; m + slotMin <= endMin; m += slotMin) {
        const st = minutesToHHMM_(m);
        const et = minutesToHHMM_(m + slotMin);

        out.push({
          slot_id: buildSlotId_(dateStr, st),
          date: dateStr,
          start_time: st,
          end_time: et,
          vendor: CFG.RULES.DEFAULT_RESERVED_BY,
          topic: CFG.RULES.DEFAULT_TOPIC,
          dept: CFG.RULES.DEFAULT_DEPT,
          capacity: CFG.RULES.DEFAULT_CAPACITY,
          status: "open",
        });
      }
    }

    d = addDays_(d, 1);
  }

  return out;
}

function buildSessionFromRulesAndOverrides_(ss, dateStr, startHHMM) {
  const base = {
    slot_id: buildSlotId_(dateStr, startHHMM),
    date: dateStr,
    start_time: startHHMM,
    end_time: addMinutesToHHMM_(startHHMM, CFG.RULES.SLOT_MINUTES),
    vendor: CFG.RULES.DEFAULT_RESERVED_BY,
    topic: CFG.RULES.DEFAULT_TOPIC,
    dept: CFG.RULES.DEFAULT_DEPT,
    capacity: CFG.RULES.DEFAULT_CAPACITY,
    status: "open",
  };

  const overrides = readSessionsAsOverrideMap_(ss);
  const o = overrides[base.slot_id];

  if (o) {
    if (o.vendor) base.vendor = o.vendor;
    if (o.topic) base.topic = o.topic;
    if (o.dept) base.dept = o.dept;
    if (toInt_(o.capacity, 0)) base.capacity = toInt_(o.capacity, base.capacity);
    if (o.status) base.status = String(o.status).toLowerCase();
  }

  return base;
}

function isSlotAllowedByRules_(dateStr, startHHMM) {
  if (!CFG.RULES.ENABLED) return false;
  if (!isDateStr_(dateStr)) return false;
  if (!/^\d{2}:\d{2}$/.test(String(startHHMM || ""))) return false;

  const d = parseDate_(dateStr);
  const wd = isoWeekday_(d);
  if (CFG.RULES.WEEKDAYS.indexOf(wd) < 0) return false;

  const startMin = hhmmToMinutes_(startHHMM);
  const ruleStart = hhmmToMinutes_(CFG.RULES.START_HHMM);
  let ruleEnd = hhmmToMinutes_(CFG.RULES.END_HHMM);
  const slotMin = toInt_(CFG.RULES.SLOT_MINUTES, 60);

  if (ruleEnd <= ruleStart) ruleEnd += 1440;

  let s = startMin;
  if (s < ruleStart && ruleEnd > 1440) s += 1440;

  return s >= ruleStart && (s + slotMin) <= ruleEnd;
}

function buildSlotId_(dateStr, startHHMM) {
  const hhmm = String(startHHMM).replace(":", "");
  return (CFG.RULES.SLOT_ID_PREFIX + dateStr + "_" + hhmm).toUpperCase();
}

function parseSlotId_(slotId) {
  const s = String(slotId || "").trim().toUpperCase();
  const m = s.match(/^SLOT_(\d{4}-\d{2}-\d{2})_(\d{4})$/);
  if (!m) return null;
  const date = m[1];
  const hhmm = m[2];
  const start_time = hhmm.slice(0, 2) + ":" + hhmm.slice(2, 4);
  return { date, start_time };
}

/**
 * ===== RESPONSE HELPERS =====
 */
function ok_(requestId, data, message) {
  return { statusCode: 200, success: true, code: "OK", message: message || "OK", data: data || {} };
}
function fail_(requestId, code, message, statusCode, data) {
  return { statusCode: statusCode || 400, success: false, code: code || "ERROR", message: message || "Error", data: data || {} };
}
function errorPayload_(requestId, code, err) {
  const statusCode = (err && err.statusCode) ? err.statusCode : 500;
  return {
    statusCode,
    success: false,
    code: (err && err.code) ? err.code : (code || "ERROR"),
    message: (err && err.message) ? err.message : String(err),
    data: { stack: (err && err.stack) ? err.stack : "" },
  };
}

/**
 * JSON / JSONP response helper
 */
function jsonResponse_(obj, e) {
  const json = JSON.stringify(obj);

  const cb = (e && e.parameter && e.parameter.callback)
    ? String(e.parameter.callback).trim()
    : "";

  const isValidCallback = cb && /^[A-Za-z_][A-Za-z0-9_\\.]*$/.test(cb);

  if (isValidCallback) {
    return ContentService
      .createTextOutput(cb + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ===== BODY PARSING =====
 */
function parseBody_(e) {
  const raw = (e && e.postData && typeof e.postData.contents === "string") ? e.postData.contents : "";
  const type = (e && e.postData && e.postData.type) ? String(e.postData.type).toLowerCase() : "";
  if (!raw) return {};

  try {
    const maybeJson = JSON.parse(raw);
    if (maybeJson && typeof maybeJson === "object") return maybeJson;
  } catch (ignore) {}

  if (type.indexOf("application/x-www-form-urlencoded") >= 0 || raw.indexOf("=") >= 0) {
    const obj = {};
    raw.split("&").forEach(pair => {
      const idx = pair.indexOf("=");
      if (idx < 0) return;
      const k = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, " "));
      const v = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, " "));
      obj[k] = v;
    });
    return obj;
  }

  return {};
}

/**
 * ===== SMALL UTILS =====
 */
function makeId_(prefix) {
  return (prefix || "id") + "_" + Utilities.getUuid().split("-")[0] + "_" + Date.now();
}
function toInt_(v, fallback) {
  const n = parseInt(v, 10);
  return isNaN(n) ? (fallback || 0) : n;
}
function isDateStr_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}
function formatDate_(d) {
  return Utilities.formatDate(d, CFG.DEFAULT_TIMEZONE, "yyyy-MM-dd");
}
function addDays_(d, days) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}
function mask_(s) {
  s = String(s || "");
  if (!s) return "";
  if (s.length <= 6) return "***";
  return s.slice(0, 2) + "***" + s.slice(-2);
}
function lower_(v) { return String(v || "").trim().toLowerCase(); }

/**
 * ===== DATE/TIME HELPERS =====
 */
function parseDate_(yyyyMMdd) {
  const parts = String(yyyyMMdd || "").split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  return new Date(y, m - 1, d);
}

// ISO weekday: 1=Mon ... 7=Sun
function isoWeekday_(dateObj) {
  const d = dateObj.getDay(); // 0..6
  return d === 0 ? 7 : d;
}

function hhmmToMinutes_(hhmm) {
  const parts = String(hhmm || "").split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (h * 60) + m;
}

function minutesToHHMM_(mins) {
  let m = parseInt(mins, 10);
  if (isNaN(m)) m = 0;
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function addMinutesToHHMM_(hhmm, minutes) {
  const base = hhmmToMinutes_(hhmm);
  return minutesToHHMM_(base + toInt_(minutes, 60));
}

/**
 * Apps Script doesn't reliably expose request headers from all clients.
 * Best-effort only.
 */
function getHeader_(e, headerName) {
  try {
    const headers = (e && e.headers) ? e.headers : null;
    if (!headers) return "";
    const key = Object.keys(headers).find(k => k.toLowerCase() === headerName.toLowerCase());
    return key ? String(headers[key]) : "";
  } catch (e2) {
    return "";
  }
}

/**
 * header index map helper (0-based indices)
 */
function indexMap_(header) {
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
  };
}

