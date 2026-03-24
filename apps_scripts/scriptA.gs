/************************************************************
 * Script A - Room Booking API (Google Apps Script Web App)
 * ----------------------------------------------------------
 * CLEAN: 2025-12-31
 *
 * - Dynamic sessions (Mon-Fri, 08:00-20:00, 60min)
 * - JSONP support for GET endpoints (sessions/days/health/book/get_api_key)
 * - Booking via GET (JSONP) for Zendesk Help Centre CORS-safe calls
 * - POST support for same-origin or server-to-server calls
 * - API key auth required except init + get_api_key
 * - Optional SESSIONS sheet overrides (capacity/cancel/manual reserve)
 ************************************************************/

const CFG = {
  DEPLOYMENT: {
    ID: "AKfycbwLge7qDCPemVqE2MsmB11HTZBOJcjFWYjj5yNLGzXKh_qVieGo8Yf5QWVTqt7xB_FU",
    WEBAPP_URL:
      "https://script.google.com/macros/s/AKfycbwLge7qDCPemVqE2MsmB11HTZBOJcjFWYjj5yNLGzXKh_qVieGo8Yf5QWVTqt7xB_FU/exec",
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
    END_HHMM: "20:00",
    SLOT_MINUTES: 60,
    TRAINING_SLOT_MINUTES: 30,
    INTERVIEW_START_HHMM: "12:00",
    INTERVIEW_ROOM: "Interview Room",
    INTERVIEW_ALIASES: ["Meeting Room"],
    TRAINING_ROOMS: ["Training Room 1", "Training Room 2"],

    DEFAULT_RESERVED_BY: "", // vendor (reserved by) override default
    DEFAULT_TOPIC: "Room Booking",
    TRAINING_TOPIC: "Training Session",
    INTERVIEW_TOPIC: "Interview Room Booking",
    DEFAULT_DEPT: "Interview Room",
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
            start_date: params.start_date || params.date,
            start_time: params.start_time,
            end_time: params.end_time,
            repeat_days: params.repeat_days,
            requester_email: params.requester_email,
            requester_name: params.requester_name,
            notes: params.notes,
            dept: params.dept,
            user_type: params.user_type,
            meeting_type: params.meeting_type,
            attendee_emails: params.attendee_emails,
            online_meeting: params.online_meeting,
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
    "start_date",
    "start_time",
    "end_date",
    "end_time",
    "duration_minutes",
    "booked_at",
    "debug_json",
    "meeting_type",      // in_person_only / in_person_plus_online
    "attendee_emails",   // comma-separated remote participant emails
    "meet_link",
    "meet_event_id",
    "meet_status",       // pending / ok / failed (blank for in_person_only)
    "meet_error_code",
    "meet_error_details",
    "meet_created_at",
  ]);

  ensureSheetWithHeader_(ss, CFG.SHEETS.SETTINGS, ["key", "value", "updated_at"]);

  // API key generate/rotate
  const props = PropertiesService.getScriptProperties();
  const rotate = String((params && params.rotate_key) ? params.rotate_key : "").trim() === "1";
  const settingsApiKey = getSettingValue_(ss, "TRAINING_API_KEY");

  let apiKey = props.getProperty("TRAINING_API_KEY");
  if (!rotate && settingsApiKey) {
    // Keep the existing SETTINGS value authoritative during normal deployments.
    apiKey = settingsApiKey;
    if (props.getProperty("TRAINING_API_KEY") !== apiKey) {
      props.setProperty("TRAINING_API_KEY", apiKey);
    }
  }
  if (!apiKey || rotate) {
    apiKey = Utilities.getUuid().replace(/-/g, "");
    props.setProperty("TRAINING_API_KEY", apiKey);
  }

  // Store settings in sheet (for visibility)
  upsertSetting_(ss, "DEPLOYMENT_ID", CFG.DEPLOYMENT.ID);
  upsertSetting_(ss, "WEBAPP_URL", CFG.DEPLOYMENT.WEBAPP_URL);
  if (rotate || !settingsApiKey) {
    upsertSetting_(ss, "TRAINING_API_KEY", apiKey);
  }
  upsertSetting_(ss, "TIMEZONE", CFG.DEFAULT_TIMEZONE);
  upsertSetting_(ss, "ALLOW_GET_BOOKING", String(CFG.ALLOW_GET_BOOKING));
  upsertSetting_(ss, "RULES_ENABLED", String(CFG.RULES.ENABLED));
  upsertSetting_(ss, "WORKING_HOURS", `${CFG.RULES.START_HHMM}-${CFG.RULES.END_HHMM}`);
  upsertSetting_(ss, "INTERVIEW_WORKING_HOURS", `${CFG.RULES.INTERVIEW_START_HHMM}-${CFG.RULES.END_HHMM}`);
  upsertSetting_(ss, "WORKING_WEEKDAYS", CFG.RULES.WEEKDAYS.join(","));
  upsertSetting_(ss, "SLOT_MINUTES", String(CFG.RULES.SLOT_MINUTES));
  upsertSetting_(ss, "TRAINING_SLOT_MINUTES", String(CFG.RULES.TRAINING_SLOT_MINUTES));

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
        training_slot_minutes: CFG.RULES.TRAINING_SLOT_MINUTES,
        interview_working_hours: `${CFG.RULES.INTERVIEW_START_HHMM}-${CFG.RULES.END_HHMM}`,
        example_slot_id: buildSlotId_("2026-01-15", "08:00"),
        note: "Training rooms use 30-minute slots from 08:00-20:00. Interview room uses 60-minute slots from 12:00-20:00.",
      },
      next_steps: [
        "1) Test sessions: ?action=sessions&from=2026-01-01&to=2026-01-31&dept=Training%20Room%201&api_key=YOUR_KEY",
        "2) Book via JSONP GET: ?action=book&start_date=2026-01-15&start_time=09:00&end_time=10:30&dept=Training%20Room%201&requester_email=...&api_key=...&callback=cb",
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
  const dept = normalizeDept_(params.dept || params.room || CFG.RULES.DEFAULT_DEPT);

  const today = formatDate_(new Date());
  const fromDate = isDateStr_(from) ? from : today;
  const toDate = isDateStr_(to) ? to : formatDate_(addDays_(new Date(), 30));

  const ss = getSS_();

  // 1) Rule-based slots
  const slots = generateSlots_(fromDate, toDate, dept);

  // 2) Overrides (SESSIONS)
  const overrides = readSessionsAsOverrideMap_(ss);

  // 3) Merge + compute availability from BOOKINGS
  const sessions = slots.map(s => {
    const o = findSessionOverride_(overrides, s.dept, s.slot_id);
    const mergedDept = normalizeDept_((o && o.dept) ? o.dept : s.dept);

    const merged = {
      slot_id: s.slot_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      vendor: (o && o.vendor) ? String(o.vendor).trim() : s.vendor, // manual reserve (optional)
      topic: (o && o.topic) ? String(o.topic).trim() : s.topic,
      dept: mergedDept,
      capacity: (o && toInt_(o.capacity, 0)) ? toInt_(o.capacity, 0) : s.capacity,
      status: (o && o.status) ? String(o.status).toLowerCase() : "open",
    };

    const bookedCount = countBookedForRange_(ss, {
      dept: merged.dept,
      start_date: merged.date,
      start_time: merged.start_time,
      end_date: merged.date,
      end_time: merged.end_time,
    });
    const cap = toInt_(merged.capacity, 0);
    const isFull = cap > 0 && bookedCount >= cap;
    const isCancelled = String(merged.status || "open").toLowerCase() === "cancelled";

    // vendor output = reserved by (latest booker if booked, else manual reserve if any)
    const latestBooker = bookedCount > 0
      ? getLatestBookerNameForRange_(ss, {
          dept: merged.dept,
          start_date: merged.date,
          start_time: merged.start_time,
          end_date: merged.date,
          end_time: merged.end_time,
        })
      : "";
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
    { from: fromDate, to: toDate, dept, total_sessions: sessions.length, sessions },
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
  const dept = normalizeDept_(params.dept || params.room || CFG.RULES.DEFAULT_DEPT);

  const today = formatDate_(new Date());
  const fromDate = isDateStr_(from) ? from : today;
  const toDate = isDateStr_(to) ? to : formatDate_(addDays_(new Date(), 30));

  const slots = generateSlots_(fromDate, toDate, dept);

  const dayMap = {};
  slots.forEach(s => dayMap[s.date] = (dayMap[s.date] || 0) + 1);

  const days = Object.keys(dayMap).sort().map(d => ({ date: d, count: dayMap[d] }));

  return ok_(requestId, { from: fromDate, to: toDate, dept, total_days: days.length, days }, "Days loaded");
}

/**
 * ===== BOOKING =====
 * POST { action:"book", slot_id, requester_email, requester_name, notes, dept, user_type, meeting_type, attendee_emails }
 * GET  ?action=book&slot_id=...&requester_email=...&api_key=...&callback=cb
 */
function handleBook_(body, requestId) {
  body = body || {};

  const requesterEmail = (body.requester_email || "").trim().toLowerCase();
  const requesterName = (body.requester_name || "").trim();
  const notes = (body.notes || "").toString().trim();
  const dept = normalizeDept_(body.dept || CFG.RULES.DEFAULT_DEPT);
  const userType = (body.user_type || "").toString().trim();
  const repeatDays = Math.min(Math.max(toInt_(body.repeat_days, 0), 0), 5);
  const attendees = 1; // forced for physical room capacity

  const attendeeRaw = body.attendee_emails !== undefined
    ? body.attendee_emails
    : (body.attendee_email !== undefined ? body.attendee_email : "");
  const attendeeParse = parseAttendeeEmails_(attendeeRaw);
  const attendeeEmails = attendeeParse.valid.slice();
  const meetingType = normalizeMeetingType_(body.meeting_type !== undefined ? body.meeting_type : body.online_meeting, attendeeEmails);
  const attendeeCsv = attendeeEmails.join(",");
  const resolved = resolveBookingWindow_(body, dept);

  if (!requesterEmail) return fail_(requestId, "MISSING_EMAIL", "requester_email is required", 400);
  if (!resolved.ok) {
    return fail_(
      requestId,
      resolved.code || "FAIL_INVALID_TIME_RANGE",
      resolved.message || messageForFailCode_(resolved.code),
      resolved.statusCode || 400,
      resolved.data || {}
    );
  }

  if (meetingType === "in_person_plus_online") {
    if (attendeeParse.invalid.length) {
      return fail_(requestId, "FAIL_INVALID_ATTENDEE_EMAIL", "One or more attendee emails are invalid.", 400, {
        invalid_attendees: attendeeParse.invalid,
      });
    }
    if (attendeeEmails.length === 0) {
      return fail_(requestId, "FAIL_MISSING_ATTENDEE_EMAIL", "Provide at least one remote attendee email for in-person + online bookings.", 400);
    }
  }

  const bookingRequests = expandBookingRequests_(resolved.request, repeatDays);
  if (!bookingRequests.length) {
    return fail_(requestId, "FAIL_INVALID_SLOT", "No valid booking dates were produced for this request.", 400);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  const ss = getSS_();
  const bookingIds = [];
  const bookings = [];
  const meets = [];
  const bookingId = makeId_("book");

  try {
    ensureBookingSheet_(ss);
    const prepared = [];

    for (let i = 0; i < bookingRequests.length; i++) {
      const validation = validateBookingRequest_(ss, bookingRequests[i], requesterEmail);
      if (!validation.ok) {
        const failCode = i > 0 ? "FAIL_REPEAT_CONFLICT" : validation.code;
        const failMessage = i > 0
          ? messageForFailCode_("FAIL_REPEAT_CONFLICT")
          : (validation.message || messageForFailCode_(validation.code));

        logBookingFailure_(ss, {
          booking_id: bookingId,
          request: bookingRequests[i],
          fail_code: failCode,
          requester_email: requesterEmail,
          requester_name: requesterName,
          notes,
          user_type: userType,
          meeting_type: meetingType,
          attendee_emails: attendeeCsv,
          meet_status: meetingType === "in_person_plus_online" ? "failed" : "",
          debug: Object.assign({}, validation.data || {}, {
            requested_range: bookingRequests[i],
            validation_code: validation.code || "",
          }),
        });

        return fail_(
          requestId,
          failCode,
          failMessage,
          validation.statusCode || 409,
          Object.assign({}, validation.data || {}, {
            failed_date: bookingRequests[i].start_date,
            dept: bookingRequests[i].dept,
          })
        );
      }
      prepared.push(validation);
    }

    for (let i = 0; i < bookingRequests.length; i++) {
      const request = bookingRequests[i];
      const validation = prepared[i];
      const currentBookingId = i === 0 ? bookingId : makeId_("book");
      const bookingRowNum = writeBooking_(ss, buildBookingRow_({
        booking_id: currentBookingId,
        slot_id: request.slot_id,
        booking_status: "booked",
        fail_code: "",
        requester_email: requesterEmail,
        requester_name: requesterName,
        attendees,
        notes,
        dept: request.dept,
        start_date: request.start_date,
        start_time: request.start_time,
        end_date: request.end_date,
        end_time: request.end_time,
        duration_minutes: request.duration_minutes,
        booked_at: new Date().toISOString(),
        debug_json: JSON.stringify({
          request,
          user_type: userType,
          sessions: validation.sessions.map(sessionToPublic_),
        }),
        meeting_type: meetingType,
        attendee_emails: attendeeCsv,
        meet_status: meetingType === "in_person_plus_online" ? "pending" : "",
      }));

      let meetResult = {
        required: meetingType === "in_person_plus_online",
        status: meetingType === "in_person_plus_online" ? "pending" : "skipped",
        meet_link: "",
        event_id: "",
        error_code: "",
        error_details: "",
        message: meetingType === "in_person_plus_online"
          ? "Meet creation pending."
          : "In-person-only booking; Meet skipped.",
        created_at: "",
      };

      if (meetingType === "in_person_plus_online") {
        meetResult = createMeetForBooking_({
          booking_id: currentBookingId,
          slot_id: request.slot_id,
          dept: request.dept,
          requester_email: requesterEmail,
          requester_name: requesterName,
          attendee_emails: attendeeEmails,
          slot_minutes: request.slot_minutes,
          start_date: request.start_date,
          start_time: request.start_time,
          end_date: request.end_date,
          end_time: request.end_time,
        });

        patchBookingMeetFieldsByRow_(ss, bookingRowNum, {
          meet_link: meetResult.meet_link,
          meet_event_id: meetResult.event_id,
          meet_status: meetResult.status,
          meet_error_code: meetResult.error_code,
          meet_error_details: meetResult.error_details,
          meet_created_at: meetResult.created_at,
        });
      }

      bookingIds.push(currentBookingId);
      bookings.push({
        booking_id: currentBookingId,
        slot_id: request.slot_id,
        start_date: request.start_date,
        start_time: request.start_time,
        end_date: request.end_date,
        end_time: request.end_time,
        dept: request.dept,
        duration_minutes: request.duration_minutes,
      });
      meets.push(meetResult);
    }

    const primaryMeet = meets[0] || {
      status: "skipped",
      meet_link: "",
      meet_event_id: "",
      error_code: "",
      error_details: "",
      message: "In-person-only booking; Meet skipped.",
    };
    const hasMeetFailure = meets.some(m => m && m.status === "failed");

    return ok_(
      requestId,
      {
        booking_id: bookingIds[0] || bookingId,
        booking_ids: bookingIds,
        booking_count: bookings.length,
        slot_id: resolved.request.slot_id,
        session: {
          slot_id: resolved.request.slot_id,
          date: resolved.request.start_date,
          start_time: resolved.request.start_time,
          end_time: resolved.request.end_time,
          dept: resolved.request.dept,
        },
        bookings,
        attendees_forced: 1,
        meeting_type: meetingType,
        attendee_emails: attendeeEmails,
        meet: {
          status: primaryMeet.status,
          meet_link: primaryMeet.meet_link,
          meet_event_id: primaryMeet.event_id,
          error_code: primaryMeet.error_code,
          error_details: primaryMeet.error_details,
          message: primaryMeet.message,
        },
        meets,
      },
      hasMeetFailure
        ? "Booked successfully, but one or more online meeting links failed."
        : "Booked successfully"
    );

  } catch (err) {
    logBookingFailure_(ss, {
      booking_id: bookingId,
      request: bookingRequests[0] || resolved.request,
      fail_code: "FAIL_SYSTEM_ERROR",
      requester_email: requesterEmail,
      requester_name: requesterName,
      notes,
      user_type: userType,
      meeting_type: meetingType,
      attendee_emails: attendeeCsv,
      meet_status: meetingType === "in_person_plus_online" ? "failed" : "",
      meet_error_code: meetingType === "in_person_plus_online" ? "FAIL_SYSTEM_ERROR" : "",
      meet_error_details: meetingType === "in_person_plus_online" ? String(err) : "",
      debug: { error: String(err), stack: err && err.stack ? err.stack : "" },
    });
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
  const existingLookup = {};
  existingHeader.forEach(h => {
    if (h) existingLookup[h.toLowerCase()] = true;
  });
  const missing = headerRow.filter(h => !existingLookup[String(h || "").trim().toLowerCase()]);

  if (missing.length) {
    sh.getRange(1, existingHeader.length + 1, 1, missing.length).setValues([missing]);
    sh.autoResizeColumns(1, existingHeader.length + missing.length);
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
    "start_date",
    "start_time",
    "end_date",
    "end_time",
    "duration_minutes",
    "booked_at",
    "debug_json",
    "meeting_type",
    "attendee_emails",
    "meet_link",
    "meet_event_id",
    "meet_status",
    "meet_error_code",
    "meet_error_details",
    "meet_created_at",
  ]);
}

function upsertSetting_(ss, key, value) {
  const sh = ss.getSheetByName(CFG.SHEETS.SETTINGS) ||
    ensureSheetWithHeader_(ss, CFG.SHEETS.SETTINGS, ["key", "value", "updated_at"]);

  const rows = sh.getDataRange().getValues();
  const now = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      if (String(rows[i][1] || "") === String(value || "")) {
        return;
      }
      sh.getRange(i + 1, 2).setValue(value);
      sh.getRange(i + 1, 3).setValue(now);
      return;
    }
  }
  sh.appendRow([key, value, now]);
}

function getSettingValue_(ss, key) {
  const sh = ss.getSheetByName(CFG.SHEETS.SETTINGS);
  if (!sh) return "";
  const rows = sh.getDataRange().getValues();
  if (!rows || rows.length < 2) return "";
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === String(key || "").trim()) {
      return String(rows[i][1] || "").trim();
    }
  }
  return "";
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
    const rawDept = String(obj.dept || "").trim();

    map[sessionKey_(norm.dept, norm.slot_id)] = norm;
    if (!rawDept) {
      map[sessionKey_("", norm.slot_id)] = norm;
    }
  }

  return map;
}

function normaliseSession_(s) {
  const dept = normalizeDept_(s.dept || "");
  const roomRules = getRoomRules_(dept);
  const dateStr = normaliseDateValue_(s.date);
  const startStr = normaliseTimeValue_(s.start_time);
  const endStr = normaliseTimeValue_(s.end_time);

  const parsed = parseSlotId_(String(s.slot_id || "").trim());
  const derivedDate = (!dateStr && parsed) ? parsed.date : dateStr;
  const derivedStart = (!startStr && parsed) ? parsed.start_time : startStr;
  const derivedEnd = (!endStr && derivedStart)
    ? addMinutesToHHMM_(derivedStart, roomRules.slot_minutes)
    : endStr;

  return {
    slot_id: String(s.slot_id || "").trim().toUpperCase(),
    date: String(derivedDate || "").trim(),
    start_time: String(derivedStart || "").trim(),
    end_time: String(derivedEnd || "").trim(),
    vendor: String(s.vendor || "").trim(), // manual reserve (optional)
    topic: String(s.topic || "").trim(),
    dept,
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
  const startDate = b.start_date || "";
  const startTime = b.start_time || "";
  const endDate = b.end_date || startDate || "";
  const endTime = b.end_time || "";
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
    start_date: startDate,
    start_time: startTime,
    end_date: endDate,
    end_time: endTime,
    duration_minutes: b.duration_minutes !== undefined && b.duration_minutes !== null
      ? toInt_(b.duration_minutes, 0)
      : durationBetweenHHMM_(startTime, endTime),
    booked_at: b.booked_at || "",
    debug_json: b.debug_json || "",
    meeting_type: b.meeting_type || "in_person_only",
    attendee_emails: b.attendee_emails || "",
    meet_link: b.meet_link || "",
    meet_event_id: b.meet_event_id || "",
    meet_status: b.meet_status || "",
    meet_error_code: b.meet_error_code || "",
    meet_error_details: b.meet_error_details || "",
    meet_created_at: b.meet_created_at || "",
  };
}

function writeBooking_(ss, booking) {
  ensureBookingSheet_(ss);
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const row = new Array(header.length).fill("");
  const normalized = buildBookingRow_(booking);

  header.forEach((key, idx) => {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      row[idx] = normalized[key];
    }
  });

  sh.appendRow(row);
  return sh.getLastRow();
}

function normalizeMeetingType_(rawType, attendeeEmails) {
  const s = lower_(rawType);
  const hasAttendees = Array.isArray(attendeeEmails) && attendeeEmails.length > 0;

  if (
    s === "online" ||
    s === "hybrid" ||
    s === "in_person_plus_online" ||
    s === "in_person_and_online" ||
    s === "in-person-plus-online" ||
    s === "inperson_plus_online" ||
    s === "1" ||
    s === "true" ||
    s === "yes" ||
    s === "on"
  ) {
    return "in_person_plus_online";
  }

  if (
    s === "in_person_only" ||
    s === "in_person" ||
    s === "in-person" ||
    s === "inperson" ||
    s === "0" ||
    s === "false" ||
    s === "no" ||
    s === "off"
  ) {
    return "in_person_only";
  }

  return hasAttendees ? "in_person_plus_online" : "in_person_only";
}

function parseAttendeeEmails_(raw) {
  const tokens = [];

  if (Array.isArray(raw)) {
    raw.forEach(v => tokens.push(String(v || "").trim()));
  } else if (raw !== undefined && raw !== null) {
    const s = String(raw || "").trim();
    if (s) {
      let parsedArray = null;
      if (s.startsWith("[") && s.endsWith("]")) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) parsedArray = parsed;
        } catch (ignore) {}
      }

      if (parsedArray) {
        parsedArray.forEach(v => tokens.push(String(v || "").trim()));
      } else {
        s.split(/[,\n;]+/).forEach(v => tokens.push(String(v || "").trim()));
      }
    }
  }

  const seen = {};
  const valid = [];
  const invalid = [];

  tokens.forEach(t => {
    const email = lower_(t);
    if (!email) return;
    if (seen[email]) return;
    seen[email] = true;
    if (isValidEmail_(email)) valid.push(email);
    else invalid.push(email);
  });

  return { valid, invalid };
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function createMeetForBooking_(params) {
  const out = {
    required: true,
    status: "failed",
    meet_link: "",
    event_id: "",
    error_code: "",
    error_details: "",
    message: "",
    created_at: "",
  };

  const hasScriptC =
    typeof createMeetForBooking_C_ === "function" ||
    typeof createOnlineMeeting === "function";

  if (!hasScriptC) {
    out.error_code = "SCRIPT_C_NOT_AVAILABLE";
    out.error_details = "createMeetForBooking_C_(params) / createOnlineMeeting(params) are not defined in this Apps Script project.";
    out.message = "Meet link generator not available.";
    return out;
  }

  try {
    const payload = {
      booking_id: params.booking_id,
      slot_id: params.slot_id,
      dept: params.dept || "",
      meeting_type: "in_person_plus_online",
      requester_name: params.requester_name,
      requester_email: params.requester_email,
      attendee_emails: params.attendee_emails || [],
      slot_minutes: params.slot_minutes || CFG.RULES.SLOT_MINUTES,
      start_iso: (params.start_date && params.start_time)
        ? params.start_date + "T" + params.start_time + ":00"
        : "",
      end_iso: (params.end_date && params.end_time)
        ? params.end_date + "T" + params.end_time + ":00"
        : "",
    };

    const res = (typeof createMeetForBooking_C_ === "function"
      ? createMeetForBooking_C_(payload)
      : createOnlineMeeting(payload)) || {};

    out.meet_link = String(res.meet_link || "").trim();
    out.event_id = String(res.event_id || "").trim();
    out.error_code = String(res.error_code || "").trim();
    out.error_details = String(res.error_details || "").trim();
    out.message = String(res.message || "").trim();
    out.created_at = String(res.created_at || "").trim();
    const status = String(res.status || "").trim().toLowerCase();

    const looksOk = res.ok === true && (status === "ok" || (!!out.meet_link && status !== "failed"));
    if (looksOk) {
      out.status = "ok";
      if (!out.created_at) out.created_at = new Date().toISOString();
      if (!out.message) out.message = "Meet link created.";
      return out;
    }

    if (res.ok === true && status === "pending") {
      out.status = "pending";
      if (!out.message) out.message = "Meet link is still processing.";
      return out;
    }

    if (!out.error_code) out.error_code = "MEET_CREATE_FAILED";
    if (!out.error_details) out.error_details = JSON.stringify(res || {});
    if (!out.message) out.message = "Meet link could not be created.";
    out.status = "failed";
    return out;
  } catch (err) {
    out.status = "failed";
    out.error_code = "MEET_CREATE_EXCEPTION";
    out.error_details = err && err.stack ? err.stack : String(err);
    out.message = "Meet link generation threw an exception.";
    return out;
  }
}

function patchBookingMeetFieldsByRow_(ss, rowNum, patch) {
  if (!rowNum || rowNum < 2) return;

  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return;

  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idx = indexMap_(header);

  setCellIfByIdx_(sh, rowNum, idx.meet_link, patch.meet_link);
  setCellIfByIdx_(sh, rowNum, idx.meet_event_id, patch.meet_event_id);
  setCellIfByIdx_(sh, rowNum, idx.meet_status, patch.meet_status);
  setCellIfByIdx_(sh, rowNum, idx.meet_error_code, patch.meet_error_code);
  setCellIfByIdx_(sh, rowNum, idx.meet_error_details, patch.meet_error_details);
  setCellIfByIdx_(sh, rowNum, idx.meet_created_at, patch.meet_created_at);
}

function setCellIfByIdx_(sheet, rowNum, colIdx, value) {
  if (colIdx === undefined || colIdx === null || colIdx < 0) return;
  if (value === undefined) return;
  sheet.getRange(rowNum, colIdx + 1).setValue(value);
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

function countBookedForSlot_(ss, slotId, dept) {
  const parsed = parseSlotId_(slotId);
  if (!parsed) return 0;
  const room = normalizeDept_(dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(room);
  return countBookedForRange_(ss, {
    dept: room,
    start_date: parsed.date,
    start_time: parsed.start_time,
    end_date: parsed.date,
    end_time: addMinutesToHHMM_(parsed.start_time, rules.slot_minutes),
  });
}

function hasActiveBookingForEmailAndSlot_(ss, email, slotId, dept) {
  const parsed = parseSlotId_(slotId);
  if (!parsed) return false;
  const room = normalizeDept_(dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(room);
  return hasActiveBookingForEmailInRange_(ss, String(email || "").trim().toLowerCase(), {
    dept: room,
    start_date: parsed.date,
    start_time: parsed.start_time,
    end_date: parsed.date,
    end_time: addMinutesToHHMM_(parsed.start_time, rules.slot_minutes),
  });
}

function getLatestBookerNameForSlot_(ss, slotId, dept) {
  const parsed = parseSlotId_(slotId);
  if (!parsed) return "";
  const room = normalizeDept_(dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(room);
  return getLatestBookerNameForRange_(ss, {
    dept: room,
    start_date: parsed.date,
    start_time: parsed.start_time,
    end_date: parsed.date,
    end_time: addMinutesToHHMM_(parsed.start_time, rules.slot_minutes),
  });
}

function countBookedForRange_(ss, request) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return 0;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  const idx = indexMap_(values[0].map(String));
  const normalized = normalizeRequestWindow_(request);
  if (!normalized) return 0;

  let count = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (lower_(row[idx.booking_status]) !== "booked") continue;
    const window = bookingRowWindow_(row, idx);
    if (!window) continue;
    if (window.dept !== normalized.dept) continue;
    if (rangesOverlap_(normalized.start_ms, normalized.end_ms, window.start_ms, window.end_ms)) {
      count++;
    }
  }
  return count;
}

function hasActiveBookingForEmailInRange_(ss, email, request) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return false;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return false;
  const idx = indexMap_(values[0].map(String));
  const normalized = normalizeRequestWindow_(request);
  if (!normalized) return false;
  const targetEmail = lower_(email);
  if (!targetEmail) return false;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (lower_(row[idx.booking_status]) !== "booked") continue;
    if (lower_(row[idx.requester_email]) !== targetEmail) continue;
    const window = bookingRowWindow_(row, idx);
    if (!window) continue;
    if (window.dept !== normalized.dept) continue;
    if (rangesOverlap_(normalized.start_ms, normalized.end_ms, window.start_ms, window.end_ms)) {
      return true;
    }
  }
  return false;
}

function getLatestBookerNameForRange_(ss, request) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return "";
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return "";
  const idx = indexMap_(values[0].map(String));
  const normalized = normalizeRequestWindow_(request);
  if (!normalized) return "";

  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (lower_(row[idx.booking_status]) !== "booked") continue;
    const window = bookingRowWindow_(row, idx);
    if (!window) continue;
    if (window.dept !== normalized.dept) continue;
    if (!rangesOverlap_(normalized.start_ms, normalized.end_ms, window.start_ms, window.end_ms)) continue;
    const name = String(row[idx.requester_name] || "").trim();
    return name || String(row[idx.requester_email] || "").trim();
  }
  return "";
}

function resolveBookingWindow_(body, dept) {
  const room = normalizeDept_(dept || body.dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(room);
  const parsed = parseSlotId_(body.slot_id || "");

  const startDateRaw = String(body.start_date || body.date || (parsed ? parsed.date : "")).trim();
  const startTimeRaw = normalizeHHMM_(body.start_time || (parsed ? parsed.start_time : ""));
  const endTimeRaw = normalizeHHMM_(body.end_time || "");
  const endDateRaw = String(body.end_date || startDateRaw).trim();

  if (!startDateRaw || !startTimeRaw) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "start_date and start_time are required.", statusCode: 400 };
  }
  if (!isDateStr_(startDateRaw)) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "start_date must be YYYY-MM-DD.", statusCode: 400 };
  }
  if (!isDateStr_(endDateRaw)) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "end_date must be YYYY-MM-DD.", statusCode: 400 };
  }
  if (startDateRaw !== endDateRaw) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "Cross-day bookings are not supported.", statusCode: 400 };
  }

  let endTime = endTimeRaw;
  if (!endTime) {
    endTime = addMinutesToHHMM_(startTimeRaw, rules.slot_minutes);
  }
  if (!/^\d{2}:\d{2}$/.test(startTimeRaw) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "start_time and end_time must use HH:mm format.", statusCode: 400 };
  }

  const request = {
    slot_id: buildSlotId_(startDateRaw, startTimeRaw),
    start_date: startDateRaw,
    start_time: startTimeRaw,
    end_date: endDateRaw,
    end_time: endTime,
    dept: room,
    slot_minutes: rules.slot_minutes,
    duration_minutes: durationBetweenHHMM_(startTimeRaw, endTime),
  };

  const window = normalizeRequestWindow_(request);
  if (!window || window.end_ms <= window.start_ms) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "end_time must be after start_time.", statusCode: 400 };
  }

  if (!isBookingWithinRules_(request, rules)) {
    return {
      ok: false,
      code: "FAIL_SLOT_NOT_ALLOWED",
      message: messageForFailCode_("FAIL_SLOT_NOT_ALLOWED"),
      statusCode: 400,
      data: { dept: room, start_time: startTimeRaw, end_time: endTime },
    };
  }

  if (isTrainingRoom_(room)) {
    if ((hhmmToMinutes_(startTimeRaw) % rules.slot_minutes) !== 0 || (hhmmToMinutes_(endTime) % rules.slot_minutes) !== 0) {
      return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "Training room bookings must align to 30-minute boundaries.", statusCode: 400 };
    }
  } else {
    if ((hhmmToMinutes_(startTimeRaw) % rules.slot_minutes) !== 0 || (hhmmToMinutes_(endTime) % rules.slot_minutes) !== 0) {
      return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "Interview room bookings must align to hourly boundaries.", statusCode: 400 };
    }
    if (request.duration_minutes !== rules.slot_minutes) {
      return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: "Interview room bookings must be exactly 60 minutes.", statusCode: 400 };
    }
  }

  return { ok: true, request };
}

function expandBookingRequests_(baseRequest, repeatDays) {
  const out = [];
  const count = Math.max(0, toInt_(repeatDays, 0));
  const baseDate = parseDate_(baseRequest.start_date);
  if (!baseDate || isNaN(baseDate.getTime())) return out;

  let cursor = new Date(baseDate.getTime());
  while (out.length < (count + 1)) {
    const isoWd = isoWeekday_(cursor);
    if (CFG.RULES.WEEKDAYS.indexOf(isoWd) >= 0) {
      const dateStr = formatDate_(cursor);
      out.push(Object.assign({}, baseRequest, {
        slot_id: buildSlotId_(dateStr, baseRequest.start_time),
        start_date: dateStr,
        end_date: dateStr,
      }));
    }
    cursor = addDays_(cursor, 1);
  }
  return out;
}

function validateBookingRequest_(ss, request, requesterEmail) {
  const room = normalizeDept_(request.dept);
  const rules = getRoomRules_(room);
  if (!isBookingWithinRules_(request, rules)) {
    return { ok: false, code: "FAIL_SLOT_NOT_ALLOWED", message: messageForFailCode_("FAIL_SLOT_NOT_ALLOWED"), statusCode: 400 };
  }

  const startMin = hhmmToMinutes_(request.start_time);
  const endMin = hhmmToMinutes_(request.end_time);
  if ((startMin % rules.slot_minutes) !== 0 || (endMin % rules.slot_minutes) !== 0) {
    return { ok: false, code: "FAIL_INVALID_TIME_RANGE", message: messageForFailCode_("FAIL_INVALID_TIME_RANGE"), statusCode: 400 };
  }

  const sessions = [];
  const overrides = readSessionsAsOverrideMap_(ss);
  for (let m = startMin; m < endMin; m += rules.slot_minutes) {
    const slotStart = minutesToHHMM_(m);
    const slotEnd = minutesToHHMM_(m + rules.slot_minutes);
    const slot = buildSessionFromRulesAndOverrides_(ss, request.start_date, slotStart, room, overrides);
    if (!slot) {
      return { ok: false, code: "FAIL_INVALID_SLOT", message: messageForFailCode_("FAIL_INVALID_SLOT"), statusCode: 404 };
    }
    if (String(slot.status || "open").toLowerCase() === "cancelled") {
      return { ok: false, code: "FAIL_CANCELLED", message: messageForFailCode_("FAIL_CANCELLED"), statusCode: 409 };
    }
    const bookedCount = countBookedForRange_(ss, {
      dept: room,
      start_date: request.start_date,
      start_time: slotStart,
      end_date: request.end_date,
      end_time: slotEnd,
    });
    const capacity = toInt_(slot.capacity, 0);
    if (capacity > 0 && bookedCount >= capacity) {
      return {
        ok: false,
        code: "FAIL_SLOT_FULL",
        message: messageForFailCode_("FAIL_SLOT_FULL"),
        statusCode: 409,
        data: { capacity, booked_count: bookedCount, slot_id: slot.slot_id },
      };
    }
    sessions.push(slot);
  }

  if (hasActiveBookingForEmailInRange_(ss, requesterEmail, request)) {
    return { ok: false, code: "FAIL_ALREADY_BOOKED", message: messageForFailCode_("FAIL_ALREADY_BOOKED"), statusCode: 409 };
  }

  if (countBookedForRange_(ss, request) > 0) {
    return { ok: false, code: "FAIL_RANGE_OVERLAP", message: messageForFailCode_("FAIL_RANGE_OVERLAP"), statusCode: 409 };
  }

  return { ok: true, sessions };
}

function logBookingFailure_(ss, params) {
  const request = params.request || {};
  writeBooking_(ss, buildBookingRow_({
    booking_id: params.booking_id || makeId_("book"),
    slot_id: request.slot_id || "",
    booking_status: "failed",
    fail_code: params.fail_code || "FAIL_SYSTEM_ERROR",
    requester_email: params.requester_email || "",
    requester_name: params.requester_name || "",
    notes: params.notes || "",
    dept: request.dept || "",
    start_date: request.start_date || "",
    start_time: request.start_time || "",
    end_date: request.end_date || request.start_date || "",
    end_time: request.end_time || "",
    duration_minutes: request.duration_minutes || 0,
    booked_at: new Date().toISOString(),
    debug_json: JSON.stringify(Object.assign({
      user_type: params.user_type || "",
    }, params.debug || {})),
    meeting_type: params.meeting_type || "in_person_only",
    attendee_emails: params.attendee_emails || "",
    meet_status: params.meet_status || "",
    meet_error_code: params.meet_error_code || "",
    meet_error_details: params.meet_error_details || "",
  }));
}

function safeJsonParse_(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (ignore) {
    return null;
  }
}

function extractRequestWindowFromDebugJson_(rawDebug) {
  const parsed = safeJsonParse_(rawDebug);
  if (!parsed || typeof parsed !== "object") return null;
  const request = parsed.request && typeof parsed.request === "object"
    ? parsed.request
    : parsed;
  const startDate = String(request.start_date || request.date || "").trim();
  const startTime = normalizeHHMM_(request.start_time || "");
  const endDate = String(request.end_date || startDate || "").trim();
  let endTime = normalizeHHMM_(request.end_time || "");
  const durationMinutes = toInt_(request.duration_minutes, 0);
  const dept = normalizeDept_(request.dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(dept);

  if (!startDate || !startTime) return null;
  if (!endTime && durationMinutes > 0) {
    endTime = addMinutesToHHMM_(startTime, durationMinutes);
  }
  if (!endTime) {
    endTime = addMinutesToHHMM_(startTime, rules.slot_minutes);
  }

  return {
    dept: dept,
    start_date: startDate,
    start_time: startTime,
    end_date: endDate || startDate,
    end_time: endTime,
    duration_minutes: durationMinutes > 0 ? durationMinutes : durationBetweenHHMM_(startTime, endTime),
  };
}

function normalizeRequestWindow_(request) {
  if (!request) return null;
  const dept = normalizeDept_(request.dept || CFG.RULES.DEFAULT_DEPT);
  const startDate = normaliseDateValue_(request.start_date || "");
  const startTime = normalizeHHMM_(normaliseTimeValue_(request.start_time || ""));
  const endDate = normaliseDateValue_(request.end_date || startDate);
  const endTime = normalizeHHMM_(normaliseTimeValue_(request.end_time || ""));
  if (!isDateStr_(startDate) || !isDateStr_(endDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return null;
  const startMs = dateTimeToMs_(startDate, startTime);
  const endMs = dateTimeToMs_(endDate, endTime);
  if (!isFinite(startMs) || !isFinite(endMs)) return null;
  return {
    dept,
    start_date: startDate,
    start_time: startTime,
    end_date: endDate,
    end_time: endTime,
    start_ms: startMs,
    end_ms: endMs,
  };
}

function bookingRowWindow_(row, idx) {
  const explicitDept = normalizeDept_(row[idx.dept] || CFG.RULES.DEFAULT_DEPT);
  let dept = explicitDept;
  let rules = getRoomRules_(dept);
  const slot = parseSlotId_(row[idx.slot_id] || "");
  const debugWindow = extractRequestWindowFromDebugJson_(idx.debug_json >= 0 ? row[idx.debug_json] : "");

  let startDate = idx.start_date >= 0 ? normaliseDateValue_(row[idx.start_date]) : "";
  let startTime = idx.start_time >= 0 ? normalizeHHMM_(normaliseTimeValue_(row[idx.start_time])) : "";
  let endDate = idx.end_date >= 0 ? normaliseDateValue_(row[idx.end_date]) : "";
  let endTime = idx.end_time >= 0 ? normalizeHHMM_(normaliseTimeValue_(row[idx.end_time])) : "";
  let durationMinutes = idx.duration_minutes >= 0 ? toInt_(row[idx.duration_minutes], 0) : 0;

  if (!isDateStr_(startDate) && debugWindow && debugWindow.start_date) startDate = debugWindow.start_date;
  if (!isDateStr_(startDate) && slot) startDate = slot.date;

  if (!/^\d{2}:\d{2}$/.test(startTime) && debugWindow && debugWindow.start_time) startTime = debugWindow.start_time;
  if (!/^\d{2}:\d{2}$/.test(startTime) && slot) startTime = slot.start_time;

  if (!isDateStr_(endDate) && debugWindow && debugWindow.end_date) endDate = debugWindow.end_date;
  if (!isDateStr_(endDate)) endDate = startDate;

  if (!/^\d{2}:\d{2}$/.test(endTime) && debugWindow && debugWindow.end_time) endTime = debugWindow.end_time;
  if (!durationMinutes && debugWindow && debugWindow.duration_minutes) {
    durationMinutes = debugWindow.duration_minutes;
  }

  if ((!row[idx.dept] || !String(row[idx.dept]).trim()) && debugWindow && debugWindow.dept) {
    dept = normalizeDept_(debugWindow.dept);
    rules = getRoomRules_(dept);
  }

  if (!isDateStr_(startDate) || !/^\d{2}:\d{2}$/.test(startTime)) return null;
  if (!/^\d{2}:\d{2}$/.test(endTime) && durationMinutes > 0) {
    endTime = addMinutesToHHMM_(startTime, durationMinutes);
  }
  if (!/^\d{2}:\d{2}$/.test(endTime)) endTime = addMinutesToHHMM_(startTime, rules.slot_minutes);
  if (!isDateStr_(endDate)) endDate = startDate;

  const window = normalizeRequestWindow_({
    dept,
    start_date: startDate,
    start_time: startTime,
    end_date: endDate,
    end_time: endTime,
  });
  return window;
}

function repairBookingWindowFields_() {
  const ss = getSS_();
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return { ok: false, error: "BOOKINGS_NOT_FOUND" };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, scanned: 0, repaired: 0 };

  const idx = indexMap_(values[0].map(String));
  let repaired = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const derived = bookingRowWindow_(row, idx);
    if (!derived) continue;

    let changed = false;
    if (idx.dept >= 0 && !String(row[idx.dept] || "").trim()) {
      sh.getRange(i + 1, idx.dept + 1).setValue(derived.dept);
      changed = true;
    }
    if (idx.start_date >= 0 && !String(row[idx.start_date] || "").trim()) {
      sh.getRange(i + 1, idx.start_date + 1).setValue(derived.start_date);
      changed = true;
    }
    if (idx.start_time >= 0 && !String(row[idx.start_time] || "").trim()) {
      sh.getRange(i + 1, idx.start_time + 1).setValue(derived.start_time);
      changed = true;
    }
    if (idx.end_date >= 0 && !String(row[idx.end_date] || "").trim()) {
      sh.getRange(i + 1, idx.end_date + 1).setValue(derived.end_date);
      changed = true;
    }
    if (idx.end_time >= 0 && !String(row[idx.end_time] || "").trim()) {
      sh.getRange(i + 1, idx.end_time + 1).setValue(derived.end_time);
      changed = true;
    }
    if (idx.duration_minutes >= 0 && !String(row[idx.duration_minutes] || "").trim()) {
      sh.getRange(i + 1, idx.duration_minutes + 1).setValue(durationBetweenHHMM_(derived.start_time, derived.end_time));
      changed = true;
    }
    if (changed) repaired++;
  }

  return { ok: true, scanned: values.length - 1, repaired: repaired };
}

function rangesOverlap_(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function dateTimeToMs_(dateStr, hhmm) {
  if (!isDateStr_(dateStr) || !/^\d{2}:\d{2}$/.test(String(hhmm || ""))) return NaN;
  const d = parseDate_(dateStr);
  if (!d || isNaN(d.getTime())) return NaN;
  const mins = hhmmToMinutes_(hhmm);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.getTime();
}

function durationBetweenHHMM_(startHHMM, endHHMM) {
  if (!/^\d{2}:\d{2}$/.test(String(startHHMM || ""))) return 0;
  if (!/^\d{2}:\d{2}$/.test(String(endHHMM || ""))) return 0;
  const diff = hhmmToMinutes_(endHHMM) - hhmmToMinutes_(startHHMM);
  return diff > 0 ? diff : 0;
}

function normalizeHHMM_(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = toInt_(m[1], -1);
  const mm = toInt_(m[2], -1);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function sessionKey_(dept, slotId) {
  const deptKey = String(dept || "").trim()
    ? normalizeDept_(dept)
    : "*";
  return deptKey + "::" + String(slotId || "").trim().toUpperCase();
}

function findSessionOverride_(map, dept, slotId) {
  const full = sessionKey_(dept, slotId);
  if (map[full]) return map[full];
  const generic = sessionKey_("", slotId);
  return map[generic] || null;
}

function isTrainingRoom_(dept) {
  const room = normalizeDept_(dept || "");
  return CFG.RULES.TRAINING_ROOMS.some(r => lower_(r) === lower_(room));
}

function normalizeDept_(value) {
  const raw = String(value || "").trim();
  if (!raw) return CFG.RULES.DEFAULT_DEPT;

  for (let i = 0; i < CFG.RULES.TRAINING_ROOMS.length; i++) {
    if (lower_(raw) === lower_(CFG.RULES.TRAINING_ROOMS[i])) {
      return CFG.RULES.TRAINING_ROOMS[i];
    }
  }

  if (lower_(raw) === lower_(CFG.RULES.INTERVIEW_ROOM)) {
    return CFG.RULES.INTERVIEW_ROOM;
  }
  for (let i = 0; i < CFG.RULES.INTERVIEW_ALIASES.length; i++) {
    if (lower_(raw) === lower_(CFG.RULES.INTERVIEW_ALIASES[i])) {
      return CFG.RULES.INTERVIEW_ROOM;
    }
  }
  if (lower_(raw) === "all") return CFG.RULES.INTERVIEW_ROOM;
  return raw;
}

function getRoomRules_(dept) {
  const room = normalizeDept_(dept || CFG.RULES.DEFAULT_DEPT);
  const training = isTrainingRoom_(room);
  return {
    dept: room,
    slot_minutes: training ? toInt_(CFG.RULES.TRAINING_SLOT_MINUTES, 30) : toInt_(CFG.RULES.SLOT_MINUTES, 60),
    start_hhmm: training ? CFG.RULES.START_HHMM : CFG.RULES.INTERVIEW_START_HHMM,
    end_hhmm: CFG.RULES.END_HHMM,
    topic: training ? CFG.RULES.TRAINING_TOPIC : CFG.RULES.INTERVIEW_TOPIC,
    capacity: CFG.RULES.DEFAULT_CAPACITY,
  };
}

function isBookingWithinRules_(request, roomRules) {
  if (!CFG.RULES.ENABLED) return false;
  if (!isDateStr_(request.start_date) || !isDateStr_(request.end_date)) return false;
  if (request.start_date !== request.end_date) return false;

  const d = parseDate_(request.start_date);
  const wd = isoWeekday_(d);
  if (CFG.RULES.WEEKDAYS.indexOf(wd) < 0) return false;

  const start = hhmmToMinutes_(request.start_time);
  const end = hhmmToMinutes_(request.end_time);
  const ruleStart = hhmmToMinutes_(roomRules.start_hhmm);
  const ruleEnd = hhmmToMinutes_(roomRules.end_hhmm);
  if (end <= start) return false;
  return start >= ruleStart && end <= ruleEnd;
}

function messageForFailCode_(code) {
  const map = {
    FAIL_SLOT_NOT_ALLOWED: "This time is outside allowed booking hours.",
    FAIL_INVALID_SLOT: "The requested slot could not be found.",
    FAIL_CANCELLED: "The requested slot has been cancelled.",
    FAIL_SLOT_FULL: "One or more requested slots are already booked.",
    FAIL_ALREADY_BOOKED: "You already have a booking that overlaps this request.",
    FAIL_INVALID_TIME_RANGE: "Please choose a valid start and end time.",
    FAIL_RANGE_OVERLAP: "This booking overlaps an existing booking.",
    FAIL_REPEAT_CONFLICT: "One or more repeat days are unavailable.",
  };
  return map[code] || "Booking request could not be completed.";
}

/**
 * ===== DYNAMIC SLOT ENGINE =====
 */
function generateSlots_(fromDateStr, toDateStr, dept) {
  if (!CFG.RULES.ENABLED) return [];
  const roomRules = getRoomRules_(dept || CFG.RULES.DEFAULT_DEPT);
  const from = parseDate_(fromDateStr);
  const to = parseDate_(toDateStr);
  if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) return [];

  const startMin = hhmmToMinutes_(roomRules.start_hhmm);
  const endMin = hhmmToMinutes_(roomRules.end_hhmm);
  const slotMin = roomRules.slot_minutes;
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
          topic: roomRules.topic,
          dept: roomRules.dept,
          capacity: roomRules.capacity,
          status: "open",
        });
      }
    }
    d = addDays_(d, 1);
  }
  return out;
}

function buildSessionFromRulesAndOverrides_(ss, dateStr, startHHMM, dept, overridesMap) {
  const room = normalizeDept_(dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(room);
  if (!isSlotAllowedByRules_(dateStr, startHHMM, room, rules.slot_minutes)) return null;

  const base = {
    slot_id: buildSlotId_(dateStr, startHHMM),
    date: dateStr,
    start_time: startHHMM,
    end_time: addMinutesToHHMM_(startHHMM, rules.slot_minutes),
    vendor: CFG.RULES.DEFAULT_RESERVED_BY,
    topic: rules.topic,
    dept: room,
    capacity: rules.capacity,
    status: "open",
  };

  const overrides = overridesMap || readSessionsAsOverrideMap_(ss);
  const override = findSessionOverride_(overrides, room, base.slot_id);
  if (override) {
    if (override.vendor) base.vendor = override.vendor;
    if (override.topic) base.topic = override.topic;
    if (override.dept) base.dept = normalizeDept_(override.dept);
    if (override.start_time) base.start_time = normalizeHHMM_(override.start_time) || base.start_time;
    if (override.end_time) base.end_time = normalizeHHMM_(override.end_time) || base.end_time;
    if (toInt_(override.capacity, 0)) base.capacity = toInt_(override.capacity, base.capacity);
    if (override.status) base.status = String(override.status).toLowerCase();
  }
  return base;
}

function isSlotAllowedByRules_(dateStr, startHHMM, dept, durationMinutes) {
  if (!CFG.RULES.ENABLED) return false;
  if (!isDateStr_(dateStr)) return false;
  const start = normalizeHHMM_(startHHMM);
  if (!start) return false;

  const room = normalizeDept_(dept || CFG.RULES.DEFAULT_DEPT);
  const rules = getRoomRules_(room);
  const duration = toInt_(durationMinutes, rules.slot_minutes) || rules.slot_minutes;

  const d = parseDate_(dateStr);
  const wd = isoWeekday_(d);
  if (CFG.RULES.WEEKDAYS.indexOf(wd) < 0) return false;

  const startMin = hhmmToMinutes_(start);
  const endMin = startMin + duration;
  const ruleStart = hhmmToMinutes_(rules.start_hhmm);
  const ruleEnd = hhmmToMinutes_(rules.end_hhmm);

  return startMin >= ruleStart && endMin <= ruleEnd;
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
    const key = String(header[i] || "").trim().toLowerCase();
    if (!key) continue;
    m[key] = i;
  }

  return {
    booking_id: m["booking_id"] ?? 0,
    slot_id: m["slot_id"] ?? 1,
    booking_status: m["booking_status"] ?? 2,
    fail_code: m["fail_code"] ?? 3,
    requester_email: m["requester_email"] ?? 4,
    requester_name: m["requester_name"] ?? 5,
    attendees: m["attendees"] ?? 6,
    notes: m["notes"] ?? 7,
    dept: m["dept"] ?? 8,
    start_date: m["start_date"] !== undefined ? m["start_date"] : -1,
    start_time: m["start_time"] !== undefined ? m["start_time"] : -1,
    end_date: m["end_date"] !== undefined ? m["end_date"] : -1,
    end_time: m["end_time"] !== undefined ? m["end_time"] : -1,
    duration_minutes: m["duration_minutes"] !== undefined ? m["duration_minutes"] : -1,
    booked_at: m["booked_at"] ?? 9,
    debug_json: m["debug_json"] ?? 10,
    meeting_type: m["meeting_type"] ?? 11,
    attendee_emails: m["attendee_emails"] ?? 12,
    meet_link: m["meet_link"] ?? 13,
    meet_event_id: m["meet_event_id"] ?? 14,
    meet_status: m["meet_status"] ?? 15,
    meet_error_code: m["meet_error_code"] ?? 16,
    meet_error_details: m["meet_error_details"] ?? 17,
    meet_created_at: m["meet_created_at"] ?? 18,
  };
}

function repairBookingWindowFields() {
  return repairBookingWindowFields_();
}

