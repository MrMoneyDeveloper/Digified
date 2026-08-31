/************************************************************
 * Script A - Room Booking API (Google Apps Script Web App)
 * ----------------------------------------------------------
 * SECURITY UPDATE: 2026-08-30
 *
 * Repo-aligned frontend contract:
 *   Digified automatic-bootstrap contract (theme 2028.2.4)
 *   docs/booking-security-protocol.md (v1)
 *
 * - Dynamic sessions (Mon-Fri)
 * - Signed JSONP GET transport retained for Zendesk Help Centre business calls
 * - session_init is the only unsigned browser action and returns a short-lived
 *   temporary session through the existing JSONP transport
 * - Normal requests use SHA-256 + HMAC-SHA256 + timestamp + nonce
 * - Normal responses are SHA-256 hashed and HMAC-SHA256 signed
 * - Permanent master secret lives only in Apps Script Script Properties
 * - Zendesk remains responsible for Help Center login, segments, and page access
 * - Apps Script runs as the deploying account and performs no end-user authorization
 * - Legacy init/get_api_key/API-key authentication is retired
 * - Optional SESSIONS sheet overrides (capacity/cancel/manual reserve)
 ************************************************************/

// IMPORTANT: Do not add browser-visible credentials to CFG.
// The public frontend may know only the web-app URL. Authentication is handled
// by the signed-session protocol implemented later in this file.
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
    MEET_MAX_DURATION_MINUTES: 60,
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
  const params = e && e.parameter ? e.parameter : {};
  const action = String(params.action || "sessions")
    .trim()
    .toLowerCase();

  let securityContext = null;

  try {
    // session_init is the only unsigned frontend action. It returns only a
    // short-lived derived session; the permanent master secret never leaves
    // Apps Script.
    if (action === "session_init") {
      const result = bookingHandleSessionInit_(requestId);
      result.meta = {
        request_id: requestId,
        took_ms: Date.now() - started,
        tz: CFG.DEFAULT_TIMEZONE,
      };
      return jsonResponse_(result, e);
    }

    // Permanently retire the credential-bootstrap endpoints.
    if (action === "init" || action === "get_api_key") {
      const retired = fail_(
        requestId,
        "ENDPOINT_RETIRED",
        "This endpoint has been retired.",
        410
      );
      retired.meta = {
        request_id: requestId,
        took_ms: Date.now() - started,
        tz: CFG.DEFAULT_TIMEZONE,
      };
      return jsonResponse_(retired, e);
    }

    if (!bookingIsAllowedAction_(action, "GET")) {
      const unknown = bookingSecurityError_(
        "UNKNOWN_ACTION",
        "Unknown action: " + action,
        400
      );
      throw unknown;
    }

    securityContext = bookingVerifySignedRequest_(
      action,
      params,
      requestId
    );

    let result;

    if (action === "sessions") {
      result = handleSessions_(params, requestId);
    } else if (action === "days") {
      result = handleDays_(params, requestId);
    } else if (action === "book") {
      if (!CFG.ALLOW_GET_BOOKING) {
        result = fail_(
          requestId,
          "GET_BOOKING_DISABLED",
          "Booking via GET is disabled.",
          403
        );
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
          working_hours:
            CFG.RULES.START_HHMM +
            "-" +
            CFG.RULES.END_HHMM,
          weekdays: CFG.RULES.WEEKDAYS.join(","),
          allow_get_booking: CFG.ALLOW_GET_BOOKING,
          security_version: BOOKING_SECURITY_CFG.VERSION,
          session_scope: securityContext.scope,
        },
        "Health OK"
      );
    }

    result.meta = {
      request_id: requestId,
      took_ms: Date.now() - started,
      tz: CFG.DEFAULT_TIMEZONE,
    };

    return jsonResponse_(
      bookingSignResponse_(result, securityContext),
      e
    );
  } catch (err) {
    const context =
      securityContext ||
      (err && err.bookingSecurityContext) ||
      bookingRecoverSecurityContext_(params);

    const payload = bookingPublicErrorPayload_(
      requestId,
      "UNHANDLED_GET_ERROR",
      err
    );

    payload.meta = {
      request_id: requestId,
      took_ms: Date.now() - started,
      tz: CFG.DEFAULT_TIMEZONE,
    };

    return jsonResponse_(
      context
        ? bookingSignResponse_(payload, context)
        : payload,
      e
    );
  }
}

function doPost(e) {
  const requestId = makeId_("req");
  const started = Date.now();
  const body = parseBody_(e);
  const action = String(body.action || "")
    .trim()
    .toLowerCase();

  let securityContext = null;

  try {
    if (action === "session_init") {
      throw bookingSecurityError_(
        "SESSION_INIT_METHOD_NOT_ALLOWED",
        "session_init must use the unsigned GET bootstrap.",
        405
      );
    }

    if (action === "init" || action === "get_api_key") {
      throw bookingSecurityError_(
        "ENDPOINT_RETIRED",
        "This endpoint has been retired.",
        410
      );
    }

    if (!bookingIsAllowedAction_(action, "POST")) {
      throw bookingSecurityError_(
        "UNKNOWN_ACTION",
        "Unknown action: " + action,
        400
      );
    }

    securityContext = bookingVerifySignedRequest_(
      action,
      body,
      requestId
    );

    let result;

    if (action === "book") {
      result = handleBook_(body, requestId);
    } else if (action === "cancel") {
      result = handleCancel_(body, requestId);
    }

    result.meta = {
      request_id: requestId,
      took_ms: Date.now() - started,
      tz: CFG.DEFAULT_TIMEZONE,
    };

    return jsonResponse_(
      bookingSignResponse_(result, securityContext),
      e
    );
  } catch (err) {
    const context =
      securityContext ||
      (err && err.bookingSecurityContext) ||
      bookingRecoverSecurityContext_(body);

    const payload = bookingPublicErrorPayload_(
      requestId,
      "UNHANDLED_POST_ERROR",
      err
    );

    payload.meta = {
      request_id: requestId,
      took_ms: Date.now() - started,
      tz: CFG.DEFAULT_TIMEZONE,
    };

    return jsonResponse_(
      context
        ? bookingSignResponse_(payload, context)
        : payload,
      e
    );
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
 * ===== ADMIN-ONLY DATA MODEL INITIALIZER =====
 *
 * Run manually from the Apps Script editor when setting up a new spreadsheet.
 * It is intentionally NOT exposed through doGet/doPost and never returns or
 * creates a browser-visible API key.
 */
function initializeBookingDataModel() {
  const ss = getSS_();

  ensureSheetWithHeader_(ss, CFG.SHEETS.SESSIONS, [
    "slot_id",
    "date",
    "start_time",
    "end_time",
    "vendor",
    "topic",
    "dept",
    "capacity",
    "status",
    "created_at",
    "updated_at",
  ]);

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

  ensureSheetWithHeader_(ss, CFG.SHEETS.SETTINGS, [
    "key",
    "value",
    "updated_at"
  ]);

  upsertSetting_(ss, "DEPLOYMENT_ID", CFG.DEPLOYMENT.ID);
  upsertSetting_(ss, "WEBAPP_URL", CFG.DEPLOYMENT.WEBAPP_URL);
  upsertSetting_(ss, "TIMEZONE", CFG.DEFAULT_TIMEZONE);
  upsertSetting_(ss, "ALLOW_GET_BOOKING", String(CFG.ALLOW_GET_BOOKING));
  upsertSetting_(ss, "RULES_ENABLED", String(CFG.RULES.ENABLED));
  upsertSetting_(
    ss,
    "WORKING_HOURS",
    CFG.RULES.START_HHMM + "-" + CFG.RULES.END_HHMM
  );
  upsertSetting_(
    ss,
    "INTERVIEW_WORKING_HOURS",
    CFG.RULES.INTERVIEW_START_HHMM + "-" + CFG.RULES.END_HHMM
  );
  upsertSetting_(
    ss,
    "WORKING_WEEKDAYS",
    CFG.RULES.WEEKDAYS.join(",")
  );
  upsertSetting_(
    ss,
    "SLOT_MINUTES",
    String(CFG.RULES.SLOT_MINUTES)
  );
  upsertSetting_(
    ss,
    "TRAINING_SLOT_MINUTES",
    String(CFG.RULES.TRAINING_SLOT_MINUTES)
  );
  upsertSetting_(
    ss,
    "MEET_MAX_DURATION_MINUTES",
    String(CFG.RULES.MEET_MAX_DURATION_MINUTES)
  );
  upsertSetting_(ss, "BOOKING_SECURITY_VERSION", "v1");
  upsertSetting_(
    ss,
    "BOOKING_SECURITY_MODE",
    "SIGNED_SESSION_HMAC_SHA256"
  );

  return {
    ok: true,
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    sheets_ready: true,
    webapp_url: CFG.DEPLOYMENT.WEBAPP_URL,
    security_version: "v1",
    note:
      "No API credential is stored in the SETTINGS sheet. " +
      "Run initializeBookingSecurity() separately to create the server-only master secret."
  };
}


/**
 * ===== SESSIONS LISTING (DYNAMIC) =====
 * GET signed request: action=sessions&from=YYYY-MM-DD&to=YYYY-MM-DD + v1 security fields
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
  const bookedWindows = getBookedWindowsContext_(ss, {
    dept: dept,
    from_date: fromDate,
    to_date: toDate
  }).windows;
  const bookingStats = buildSessionBookingStats_(slots, bookedWindows);

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

    const stats = bookingStats[merged.slot_id] || { booked_count: 0, latest_booker: "" };
    const bookedCount = stats.booked_count;
    const cap = toInt_(merged.capacity, 0);
    const isFull = cap > 0 && bookedCount >= cap;
    const isCancelled = String(merged.status || "open").toLowerCase() === "cancelled";

    // vendor output = reserved by (latest booker if booked, else manual reserve if any)
    const latestBooker = bookedCount > 0 ? stats.latest_booker : "";
    const reservedBy = latestBooker ? latestBooker : (merged.vendor || "");

    return {
      slot_id: merged.slot_id,
      date: merged.date,
      start_time: merged.start_time,
      end_time: merged.end_time,

      vendor: reservedBy,         // back-compat
      reserved_by: reservedBy,    // explicit for new UI
      booker_name: reservedBy,    // alias used by legacy UI scripts
      reservedby: reservedBy,     // legacy snake/camel variant

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
 * GET signed request: action=days&from=YYYY-MM-DD&to=YYYY-MM-DD + v1 security fields
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
 * GET  signed JSONP request: action=book + business fields + v1 security fields
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
    if (toInt_(resolved.request.duration_minutes, 0) > toInt_(CFG.RULES.MEET_MAX_DURATION_MINUTES, 60)) {
      return fail_(
        requestId,
        "FAIL_MEET_DURATION_LIMIT",
        messageForFailCode_("FAIL_MEET_DURATION_LIMIT"),
        400,
        {
          duration_minutes: resolved.request.duration_minutes,
          max_minutes: CFG.RULES.MEET_MAX_DURATION_MINUTES,
        }
      );
    }
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
    const bookingContext = {
      overrides: readSessionsAsOverrideMap_(ss),
      bookedWindows: getBookedWindowsContext_(ss, {
        dept: resolved.request.dept,
        from_date: bookingRequests[0].start_date,
        to_date: bookingRequests[bookingRequests.length - 1].start_date
      }).windows
    };

    for (let i = 0; i < bookingRequests.length; i++) {
      const validation = validateBookingRequest_(ss, bookingRequests[i], requesterEmail, bookingContext);
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
      const provisionalWindow = normalizeRequestWindow_(bookingRequests[i]);
      if (provisionalWindow) {
        bookingContext.bookedWindows.push(Object.assign({}, provisionalWindow, {
          requester_name: requesterName || requesterEmail,
          requester_email: requesterEmail
        }));
      }
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
 * Booking_Security.gs
 * Signed booking protocol backend for Digified booking client v1.
 *
 * IMPORTANT
 * - Permanent master secret lives only in Script Properties.
 * - HTTPS/TLS provides transport encryption.
 * - Requests use SHA-256 + HMAC-SHA256 + timestamp + nonce.
 * - Responses are SHA-256 hashed + HMAC-SHA256 signed.
 * - Zendesk controls Help Center login and booking-page access. Apps Script does
 *   not duplicate user, role, tag, segment, domain, or IT-approval checks.
 *
 * Frontend contract:
 * docs/booking-security-protocol.md
 */

const BOOKING_SECURITY_CFG = Object.freeze({
  VERSION: "v1",

  // Keep these values aligned with the frontend contract in GitHub.
  FRONTEND_BASELINE_COMMIT: "d66a9404c6d4773cd8be04a45c5bd2e0874286e0",
  FRONTEND_PROTOCOL_DOC_SHA: "31eb77b4c0bd68873f158834c5675088c78214ad",
  FRONTEND_SECURITY_JS_SHA: "b58d62a4f49f25b843bd0899bbca98edfaf84bcdaf0224a5d5c71cc1ee7aec90",
  FRONTEND_BOOKING_CLIENT_SHA: "52f4d2d9abe4355ed698216937058952211aa68565c8a075eb541f0d19e51211",
  FRONTEND_LEGACY_BOOKING_CLIENT_SHA: "205e2d88a5183a35489fd88749af5a4eb5e2b817a53a048e328e9678f40f221d",
  FRONTEND_THEME_SCRIPT_SHA: "2bc98edc5a312346c1134fb187b926e91ae58933d4e45b87e69bb9fb5e891a27",
  FRONTEND_CONFIG_JS_SHA: "c62f11b9f1aeba7144d962528cb362bbcc639b4de8d2a3e6dd74c6be2954940c",
  THEME_VERSION: "2028.2.4",
  REQUIRED_WEBAPP_ACCESS: "ANYONE_ANONYMOUS",
  REQUIRED_EXECUTE_AS: "USER_DEPLOYING",
  MASTER_SECRET_PROP: "BOOKING_MASTER_SECRET",
  LEGACY_API_KEY_PROP: "TRAINING_API_KEY",

  // Frontend accepts responses inside a 5 minute window.
  REQUEST_WINDOW_MS: 5 * 60 * 1000,
  SESSION_TTL_MS: 10 * 60 * 1000,

  TOKEN_CONTEXT: "booking-session-token-v1",
  KEY_CONTEXT: "booking-session-key-v1",
  NONCE_CACHE_PREFIX: "booking_nonce_v1_",

  RESERVED_FIELDS: Object.freeze({
    action: true,
    callback: true,
    _ts: true,
    security: true,
    security_version: true,
    session_id: true,
    timestamp: true,
    nonce: true,
    payload_hash: true,
    signature: true,
  }),
});

/**
 * Run ONCE from the Apps Script editor before deploying the secure frontend.
 *
 * This:
 * - creates a fresh server-only master secret if one does not already exist
 * - removes the legacy exposed TRAINING_API_KEY Script Property
 * - overwrites the legacy SETTINGS-sheet value if the sheet exists
 *
 * The master secret is never returned.
 */
function initializeBookingSecurity() {
  const props = PropertiesService.getScriptProperties();
  let masterSecret = props.getProperty(BOOKING_SECURITY_CFG.MASTER_SECRET_PROP);

  if (!masterSecret) {
    masterSecret = bookingGenerateMasterSecret_();
    props.setProperty(BOOKING_SECURITY_CFG.MASTER_SECRET_PROP, masterSecret);
  }

  // Revoke the formerly browser-visible key.
  props.deleteProperty(BOOKING_SECURITY_CFG.LEGACY_API_KEY_PROP);

  // Scrub the current spreadsheet copy of the old key where possible.
  try {
    const ss = getSS_();
    if (ss) {
      upsertSetting_(
        ss,
        BOOKING_SECURITY_CFG.LEGACY_API_KEY_PROP,
        "[REVOKED - SIGNED SESSION PROTOCOL ACTIVE]"
      );
      upsertSetting_(ss, "BOOKING_SECURITY_VERSION", BOOKING_SECURITY_CFG.VERSION);
      upsertSetting_(ss, "BOOKING_SECURITY_MODE", "SIGNED_SESSION_HMAC_SHA256");
    }
  } catch (ignore) {
    // Security initialization must not reveal the secret or fail only because
    // the optional settings sheet is unavailable.
  }

  return {
    ok: true,
    security_version: BOOKING_SECURITY_CFG.VERSION,
    master_secret_configured: true,
    legacy_api_key_revoked: !props.getProperty(BOOKING_SECURITY_CFG.LEGACY_API_KEY_PROP),
    deployment_requirements: {
      webapp_access: BOOKING_SECURITY_CFG.REQUIRED_WEBAPP_ACCESS,
      execute_as: BOOKING_SECURITY_CFG.REQUIRED_EXECUTE_AS,
      anonymous_transport: true,
    },
  };
}

/**
 * Explicit emergency rotation. Existing signed sessions become invalid.
 * Run from the Apps Script editor only.
 */
function rotateBookingMasterSecret() {
  const props = PropertiesService.getScriptProperties();
  const masterSecret = bookingGenerateMasterSecret_();
  props.setProperty(BOOKING_SECURITY_CFG.MASTER_SECRET_PROP, masterSecret);
  props.deleteProperty(BOOKING_SECURITY_CFG.LEGACY_API_KEY_PROP);

  return {
    ok: true,
    rotated_at: new Date().toISOString(),
  };
}

/**
 * Safe diagnostic. Does not expose the master or a session key.
 */
function verifyBookingSecurityConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const masterSecret = props.getProperty(BOOKING_SECURITY_CFG.MASTER_SECRET_PROP) || "";
  return {
    ok: !!masterSecret,
    security_version: BOOKING_SECURITY_CFG.VERSION,
    master_secret_configured: !!masterSecret,
    deployment_requirements: {
      webapp_access: BOOKING_SECURITY_CFG.REQUIRED_WEBAPP_ACCESS,
      execute_as: BOOKING_SECURITY_CFG.REQUIRED_EXECUTE_AS,
      anonymous_transport: true,
    },
    important_note:
      "Zendesk controls end-user login and booking-page access. Apps Script " +
      "runs as USER_DEPLOYING and keeps permanent credentials server-side.",
  };
}

/**
 * Safe alignment diagnostic. Use this after frontend/backend changes so the
 * deployed Apps Script can be checked against the GitHub contract it expects.
 */
function getBookingSecurityContractInfo() {
  return {
    protocol_version: BOOKING_SECURITY_CFG.VERSION,
    frontend_baseline_commit: BOOKING_SECURITY_CFG.FRONTEND_BASELINE_COMMIT,
    frontend_protocol_doc_sha: BOOKING_SECURITY_CFG.FRONTEND_PROTOCOL_DOC_SHA,
    frontend_security_js_sha256: BOOKING_SECURITY_CFG.FRONTEND_SECURITY_JS_SHA,
    frontend_booking_client_sha256_normalized: BOOKING_SECURITY_CFG.FRONTEND_BOOKING_CLIENT_SHA,
    frontend_legacy_booking_client_sha256_normalized: BOOKING_SECURITY_CFG.FRONTEND_LEGACY_BOOKING_CLIENT_SHA,
    frontend_theme_script_sha256_normalized: BOOKING_SECURITY_CFG.FRONTEND_THEME_SCRIPT_SHA,
    frontend_config_js_sha256: BOOKING_SECURITY_CFG.FRONTEND_CONFIG_JS_SHA,
    theme_version: BOOKING_SECURITY_CFG.THEME_VERSION,
    transport: "Automatic unsigned JSONP session bootstrap + signed JSONP business requests",
    session_init_auth: "No Apps Script end-user authorization; Zendesk controls page access",
    required_webapp_access: BOOKING_SECURITY_CFG.REQUIRED_WEBAPP_ACCESS,
    required_execute_as: BOOKING_SECURITY_CFG.REQUIRED_EXECUTE_AS,
    anonymous_deployment_supported: true,
    unsigned_actions: ["session_init"],
    request_hash: "SHA-256",
    request_signature: "HMAC-SHA256",
    response_hash: "SHA-256",
    response_signature: "HMAC-SHA256",
    session_storage: "browser memory only",
    master_secret_storage: "Apps Script Script Properties only"
  };
}


/**
 * Generate short-lived session material for the automatic unsigned bootstrap.
 *
 * SECURITY BOUNDARY:
 * The web app deployment MUST use:
 *   executeAs: USER_DEPLOYING
 *   access: ANYONE_ANONYMOUS
 *
 * Zendesk remains the end-user login and page-authorization boundary. This
 * bootstrap does not duplicate Zendesk user, role, tag, segment, or domain checks.
 * Its purpose is to keep permanent credentials out of browser-delivered code and
 * provide short-lived request-integrity keys over HTTPS.
 */
function bookingHandleSessionInit_(requestId) {
  const now = Date.now();
  const expiresAt = now + BOOKING_SECURITY_CFG.SESSION_TTL_MS;
  const masterSecret = bookingGetMasterSecret_();

  const tokenPayload = {
    exp: expiresAt,
    iat: now,
    jti: bookingRandomHex32_(),
    scope: "booking",
    v: BOOKING_SECURITY_CFG.VERSION,
  };

  const payloadJson = bookingCanonicalJson_(tokenPayload, false);
  const payloadB64 = bookingBase64UrlEncode_(payloadJson);
  const tokenSignature = bookingHmacSha256Hex_(
    masterSecret,
    BOOKING_SECURITY_CFG.TOKEN_CONTEXT + "\n" + payloadB64
  );
  const sessionId = payloadB64 + "." + tokenSignature;
  const sessionKey = bookingDeriveSessionKey_(masterSecret, sessionId);

  return ok_(
    requestId,
    {
      session_id: sessionId,
      session_key: sessionKey,
      expires_at: expiresAt,
      server_time: now,
      security_version: BOOKING_SECURITY_CFG.VERSION,
    },
    "Secure booking session established"
  );
}

/**
 * Verify a signed business request and return its short-lived session context.
 *
 * params must be the exact business/security parameter object used by the
 * transport. For JSONP, callback and _ts are excluded from hashing.
 */
function bookingVerifySignedRequest_(action, params, requestId) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  const source = params && typeof params === "object" ? params : {};

  let context = null;

  try {
    if (
      !normalizedAction ||
      normalizedAction === "session_init" ||
      /[\r\n]/.test(normalizedAction)
    ) {
      throw bookingSecurityError_(
        "INVALID_ACTION",
        "Secure booking request is invalid.",
        400
      );
    }

    const version = String(source.security_version || "");
    const sessionId = String(source.session_id || "");
    const timestampText = String(source.timestamp || "");
    const nonce = String(source.nonce || "").toLowerCase();
    const payloadHash = String(source.payload_hash || "").toLowerCase();
    const signature = String(source.signature || "").toLowerCase();

    if (version !== BOOKING_SECURITY_CFG.VERSION) {
      throw bookingSecurityError_(
        "SECURITY_VERSION_INVALID",
        "Secure booking protocol version is invalid.",
        401
      );
    }

    if (!sessionId || /[\r\n]/.test(sessionId)) {
      throw bookingSecurityError_(
        "SESSION_INVALID",
        "Secure booking session is invalid.",
        401
      );
    }

    // Verify the stateless server-signed session token first. Once this succeeds
    // we can derive the temporary session key and sign authentication failures.
    context = bookingParseSessionContext_(sessionId);

    if (!/^\d+$/.test(timestampText)) {
      throw bookingSecurityErrorWithContext_(
        "REQUEST_TIMESTAMP_INVALID",
        "Secure booking request timestamp is invalid.",
        401,
        context
      );
    }

    if (!/^[0-9a-f]{32}$/.test(nonce)) {
      throw bookingSecurityErrorWithContext_(
        "NONCE_INVALID",
        "Secure booking request nonce is invalid.",
        401,
        context
      );
    }

    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      throw bookingSecurityErrorWithContext_(
        "PAYLOAD_HASH_INVALID",
        "Secure booking payload hash is invalid.",
        401,
        context
      );
    }

    if (!/^[0-9a-f]{64}$/.test(signature)) {
      throw bookingSecurityErrorWithContext_(
        "SIGNATURE_INVALID",
        "Secure booking request signature is invalid.",
        401,
        context
      );
    }

    const now = Date.now();
    const timestamp = Number(timestampText);

    if (now > context.expiresAt) {
      throw bookingSecurityErrorWithContext_(
        "SESSION_EXPIRED",
        "Secure booking session expired.",
        401,
        context
      );
    }

    if (
      Math.abs(now - timestamp) > BOOKING_SECURITY_CFG.REQUEST_WINDOW_MS ||
      timestamp < context.issuedAt - BOOKING_SECURITY_CFG.REQUEST_WINDOW_MS ||
      timestamp > context.expiresAt
    ) {
      throw bookingSecurityErrorWithContext_(
        "REQUEST_TIMESTAMP_INVALID",
        "Secure booking request timestamp is outside the accepted window.",
        401,
        context
      );
    }

    const canonicalBusiness = bookingCanonicalizeBusinessParameters_(source);
    const calculatedPayloadHash = bookingSha256Hex_(canonicalBusiness);

    if (!bookingConstantTimeHexEqual_(calculatedPayloadHash, payloadHash)) {
      throw bookingSecurityErrorWithContext_(
        "PAYLOAD_HASH_MISMATCH",
        "Secure booking payload validation failed.",
        401,
        context
      );
    }

    const stringToSign = [
      BOOKING_SECURITY_CFG.VERSION,
      normalizedAction,
      timestampText,
      nonce,
      sessionId,
      payloadHash,
    ].join("\n");

    const expectedSignature = bookingHmacSha256Hex_(
      context.sessionKey,
      stringToSign
    );

    if (!bookingConstantTimeHexEqual_(expectedSignature, signature)) {
      throw bookingSecurityErrorWithContext_(
        "SIGNATURE_INVALID",
        "Secure booking request signature is invalid.",
        401,
        context
      );
    }

    bookingReserveNonce_(sessionId, nonce, context.expiresAt);

    return context;
  } catch (err) {
    if (context && !err.bookingSecurityContext) {
      err.bookingSecurityContext = context;
    }
    throw err;
  }
}

/**
 * Attach signed security metadata to every normal business response.
 */
function bookingSignResponse_(response, context) {
  if (!context || !context.sessionId || !context.sessionKey) {
    throw new Error("Cannot sign booking response without a session context.");
  }

  const body = {};
  Object.keys(response || {}).forEach(function (key) {
    if (key !== "security") body[key] = response[key];
  });

  const canonicalBody = bookingCanonicalJson_(body, false);
  const bodyHash = bookingSha256Hex_(canonicalBody);
  const timestamp = String(Date.now());
  const nonce = bookingRandomHex32_();

  const stringToSign = [
    BOOKING_SECURITY_CFG.VERSION,
    "response",
    timestamp,
    nonce,
    context.sessionId,
    bodyHash,
  ].join("\n");

  const signature = bookingHmacSha256Hex_(
    context.sessionKey,
    stringToSign
  );

  body.security = {
    version: BOOKING_SECURITY_CFG.VERSION,
    session_id: context.sessionId,
    timestamp: Number(timestamp),
    nonce: nonce,
    body_hash: bodyHash,
    signature: signature,
  };

  return body;
}

/**
 * Safe error payload for browser responses.
 * Deliberately omits stack traces and internal exception details.
 */
function bookingPublicErrorPayload_(requestId, fallbackCode, err) {
  const statusCode =
    err && Number(err.statusCode) ? Number(err.statusCode) : 500;
  const code =
    err && err.code ? String(err.code) : String(fallbackCode || "ERROR");

  const safeMessage =
    err && err.bookingSafeMessage
      ? String(err.bookingSafeMessage)
      : statusCode >= 500
        ? "Booking request could not be completed."
        : err && err.message
          ? String(err.message)
          : "Booking request could not be completed.";

  return {
    statusCode: statusCode,
    success: false,
    code: code,
    message: safeMessage,
    data: {},
  };
}

/**
 * Recover a signing context from a syntactically valid server-issued session
 * token so that authentication errors can still be signed.
 */
function bookingRecoverSecurityContext_(params) {
  try {
    const sessionId = String(
      (params && params.session_id) || ""
    ).trim();
    if (!sessionId) return null;
    return bookingParseSessionContext_(sessionId);
  } catch (ignore) {
    return null;
  }
}

function bookingIsAllowedAction_(action, method) {
  const normalizedAction = String(action || "").toLowerCase();
  const normalizedMethod = String(method || "GET").toUpperCase();

  if (normalizedMethod === "GET") {
    return (
      normalizedAction === "sessions" ||
      normalizedAction === "days" ||
      normalizedAction === "book" ||
      normalizedAction === "health"
    );
  }

  if (normalizedMethod === "POST") {
    return normalizedAction === "book" || normalizedAction === "cancel";
  }

  return false;
}

function bookingGetMasterSecret_() {
  const secret = String(
    PropertiesService.getScriptProperties().getProperty(
      BOOKING_SECURITY_CFG.MASTER_SECRET_PROP
    ) || ""
  );

  if (!secret) {
    throw bookingSecurityError_(
      "BOOKING_SECURITY_NOT_CONFIGURED",
      "Secure booking is not configured.",
      500
    );
  }

  return secret;
}

function bookingGenerateMasterSecret_() {
  // Multiple independent UUIDs are hashed so the stored value is fixed-length
  // and never needs to leave Apps Script.
  const entropy = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid(),
    String(Date.now()),
  ].join("|");

  return bookingSha256Hex_(entropy);
}

function bookingParseSessionContext_(sessionId) {
  const value = String(sessionId || "");
  const parts = value.split(".");

  if (
    parts.length !== 2 ||
    !parts[0] ||
    !/^[0-9a-f]{64}$/.test(parts[1])
  ) {
    throw bookingSecurityError_(
      "SESSION_INVALID",
      "Secure booking session is invalid.",
      401
    );
  }

  const payloadB64 = parts[0];
  const providedTokenSignature = parts[1];
  const masterSecret = bookingGetMasterSecret_();

  const expectedTokenSignature = bookingHmacSha256Hex_(
    masterSecret,
    BOOKING_SECURITY_CFG.TOKEN_CONTEXT + "\n" + payloadB64
  );

  if (
    !bookingConstantTimeHexEqual_(
      expectedTokenSignature,
      providedTokenSignature
    )
  ) {
    throw bookingSecurityError_(
      "SESSION_INVALID",
      "Secure booking session is invalid.",
      401
    );
  }

  let payload;
  try {
    const json = bookingBase64UrlDecode_(payloadB64);
    payload = JSON.parse(json);
  } catch (ignore) {
    throw bookingSecurityError_(
      "SESSION_INVALID",
      "Secure booking session is invalid.",
      401
    );
  }

  if (
    !payload ||
    payload.v !== BOOKING_SECURITY_CFG.VERSION ||
    payload.scope !== "booking" ||
    !Number.isFinite(Number(payload.iat)) ||
    !Number.isFinite(Number(payload.exp)) ||
    Number(payload.exp) <= Number(payload.iat) ||
    !payload.jti
  ) {
    throw bookingSecurityError_(
      "SESSION_INVALID",
      "Secure booking session is invalid.",
      401
    );
  }

  return {
    sessionId: value,
    sessionKey: bookingDeriveSessionKey_(masterSecret, value),
    scope: "booking",
    issuedAt: Number(payload.iat),
    expiresAt: Number(payload.exp),
    jti: String(payload.jti),
  };
}

function bookingDeriveSessionKey_(masterSecret, sessionId) {
  return bookingHmacSha256Hex_(
    masterSecret,
    BOOKING_SECURITY_CFG.KEY_CONTEXT + "\n" + String(sessionId)
  );
}

function bookingReserveNonce_(sessionId, nonce, expiresAt) {
  const now = Date.now();
  const ttlSeconds = Math.max(
    60,
    Math.ceil((Number(expiresAt) - now) / 1000) +
      Math.ceil(BOOKING_SECURITY_CFG.REQUEST_WINDOW_MS / 1000)
  );

  const nonceKeyHash = bookingSha256Hex_(
    String(sessionId) + "\n" + String(nonce)
  );
  const cacheKey =
    BOOKING_SECURITY_CFG.NONCE_CACHE_PREFIX + nonceKeyHash.slice(0, 48);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const cache = CacheService.getScriptCache();

    if (cache.get(cacheKey)) {
      throw bookingSecurityError_(
        "REPLAY_DETECTED",
        "Secure booking request was already processed.",
        409
      );
    }

    cache.put(cacheKey, "1", ttlSeconds);
  } finally {
    lock.releaseLock();
  }
}

function bookingCanonicalizeBusinessParameters_(params) {
  const normalized = {};
  const source = params && typeof params === "object" ? params : {};

  Object.keys(source).forEach(function (key) {
    const value = source[key];

    if (
      BOOKING_SECURITY_CFG.RESERVED_FIELDS[key] ||
      value === undefined ||
      value === null
    ) {
      return;
    }

    normalized[String(key)] = bookingRequestValueToString_(value);
  });

  return Object.keys(normalized)
    .sort()
    .map(function (key) {
      return (
        bookingEncodeRfc3986_(key) +
        "=" +
        bookingEncodeRfc3986_(normalized[key])
      );
    })
    .join("&");
}

function bookingRequestValueToString_(value) {
  if (
    Array.isArray(value) ||
    (value && typeof value === "object")
  ) {
    return bookingCanonicalJson_(value, false);
  }

  return String(value);
}

/**
 * Mirrors assets/booking-security.js canonicalJson().
 */
function bookingCanonicalJson_(value, inArray) {
  if (value === null) return "null";

  const valueType = typeof value;

  if (valueType === "string" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (valueType === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }

  if (
    valueType === "undefined" ||
    valueType === "function" ||
    valueType === "symbol"
  ) {
    return inArray ? "null" : undefined;
  }

  if (valueType === "bigint") {
    throw new TypeError(
      "BigInt values are not supported in booking payloads."
    );
  }

  if (Array.isArray(value)) {
    return (
      "[" +
      value
        .map(function (item) {
          const encoded = bookingCanonicalJson_(item, true);
          return encoded === undefined ? "null" : encoded;
        })
        .join(",") +
      "]"
    );
  }

  if (value && valueType === "object") {
    const entries = [];

    Object.keys(value)
      .sort()
      .forEach(function (key) {
        const encoded = bookingCanonicalJson_(
          value[key],
          false
        );

        if (encoded !== undefined) {
          entries.push(JSON.stringify(key) + ":" + encoded);
        }
      });

    return "{" + entries.join(",") + "}";
  }

  return inArray ? "null" : undefined;
}

function bookingEncodeRfc3986_(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    function (character) {
      return (
        "%" +
        character.charCodeAt(0).toString(16).toUpperCase()
      );
    }
  );
}

function bookingSha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bookingBytesToHex_(bytes);
}

/**
 * Argument order intentionally matches Utilities:
 * value first, key second.
 */
function bookingHmacSha256Hex_(key, value) {
  const bytes = Utilities.computeHmacSha256Signature(
    String(value),
    String(key),
    Utilities.Charset.UTF_8
  );
  return bookingBytesToHex_(bytes);
}

function bookingBytesToHex_(bytes) {
  return (bytes || [])
    .map(function (byte) {
      const unsigned = (Number(byte) + 256) % 256;
      return unsigned.toString(16).padStart(2, "0");
    })
    .join("");
}

function bookingConstantTimeHexEqual_(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();

  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}

function bookingRandomHex32_() {
  return Utilities.getUuid().replace(/-/g, "").toLowerCase();
}

function bookingBase64UrlEncode_(value) {
  return Utilities.base64EncodeWebSafe(
    String(value),
    Utilities.Charset.UTF_8
  ).replace(/=+$/g, "");
}

function bookingBase64UrlDecode_(value) {
  let input = String(value || "");
  const remainder = input.length % 4;

  if (remainder) {
    input += "=".repeat(4 - remainder);
  }

  const bytes = Utilities.base64DecodeWebSafe(input);
  return Utilities.newBlob(bytes).getDataAsString("UTF-8");
}

function bookingSecurityError_(code, message, statusCode) {
  const err = new Error(String(message || "Secure booking request failed."));
  err.code = String(code || "BOOKING_SECURITY_ERROR");
  err.statusCode = Number(statusCode || 401);
  err.bookingSafeMessage = String(
    message || "Secure booking request failed."
  );
  return err;
}

function bookingSecurityErrorWithContext_(
  code,
  message,
  statusCode,
  context
) {
  const err = bookingSecurityError_(code, message, statusCode);
  err.bookingSecurityContext = context || null;
  return err;
}

/**
 * Lightweight protocol self-test. Run from the editor after setup.
 * Returns hashes/fingerprints only, never secrets.
 */
function selfTestBookingSecurityProtocol() {
  const canonical = bookingCanonicalizeBusinessParameters_({
    b: 2,
    a: "hello world",
    arr: ["x", 2, { z: true, a: "first" }],
    nil: null,
    signature: "ignored"
  });

  const expectedCanonical =
    "a=hello%20world&arr=%5B%22x%22%2C2%2C%7B%22a%22%3A%22first%22%2C%22z%22%3Atrue%7D%5D&b=2";

  const shaVector = bookingSha256Hex_("abc");
  const expectedSha =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  const hmacVector = bookingHmacSha256Hex_(
    "key",
    "The quick brown fox jumps over the lazy dog"
  );
  const expectedHmac =
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";

  const requestPayloadHash = bookingSha256Hex_("a=1&b=2");
  const requestString = [
    "v1",
    "book",
    "1700000000000",
    "00112233445566778899aabbccddeeff",
    "test-session",
    requestPayloadHash
  ].join("\\n");

  const requestSignature = bookingHmacSha256Hex_(
    "temporary-test-session-key",
    requestString
  );

  const responseBody = {
    success: true,
    data: {
      sessions: [
        { slot_id: "one", available: true }
      ]
    }
  };
  const responseCanonical = bookingCanonicalJson_(responseBody, false);
  const responseBodyHash = bookingSha256Hex_(responseCanonical);
  const responseString = [
    "v1",
    "response",
    "1700000000000",
    "00112233445566778899aabbccddeeff",
    "test-session",
    responseBodyHash
  ].join("\\n");
  const responseSignature = bookingHmacSha256Hex_(
    "temporary-test-session-key",
    responseString
  );

  const checks = {
    canonicalization_matches_frontend_test:
      canonical === expectedCanonical,
    sha256_known_vector_matches:
      shaVector === expectedSha,
    hmac_sha256_known_vector_matches:
      hmacVector === expectedHmac,
    request_payload_hash_is_hex64:
      /^[0-9a-f]{64}$/.test(requestPayloadHash),
    request_signature_is_hex64:
      /^[0-9a-f]{64}$/.test(requestSignature),
    response_body_hash_is_hex64:
      /^[0-9a-f]{64}$/.test(responseBodyHash),
    response_signature_is_hex64:
      /^[0-9a-f]{64}$/.test(responseSignature),
    protocol_is_v1:
      BOOKING_SECURITY_CFG.VERSION === "v1"
  };

  return {
    ok: Object.keys(checks).every(function (key) { return checks[key] === true; }),
    checks: checks,
    protocol_version: BOOKING_SECURITY_CFG.VERSION,
    frontend_baseline_commit: BOOKING_SECURITY_CFG.FRONTEND_BASELINE_COMMIT,
    theme_version: BOOKING_SECURITY_CFG.THEME_VERSION,
    required_webapp_access: BOOKING_SECURITY_CFG.REQUIRED_WEBAPP_ACCESS,
    canonical_request_test_value: canonical,
    sha256_test_value: shaVector,
    hmac_test_value: hmacVector
  };
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

function getBookedWindowsContext_(ss, filters) {
  const sh = ss.getSheetByName(CFG.SHEETS.BOOKINGS);
  if (!sh) return { windows: [] };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { windows: [] };

  const idx = indexMap_(values[0].map(String));
  const filterDept = filters && filters.dept ? normalizeDept_(filters.dept) : "";
  const fromDate = filters && filters.from_date ? normaliseDateValue_(filters.from_date) : "";
  const toDate = filters && filters.to_date ? normaliseDateValue_(filters.to_date) : "";
  const windows = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (lower_(row[idx.booking_status]) !== "booked") continue;

    const window = bookingRowWindow_(row, idx);
    if (!window) continue;
    if (filterDept && window.dept !== filterDept) continue;
    if (fromDate && isDateStr_(window.end_date) && window.end_date < fromDate) continue;
    if (toDate && isDateStr_(window.start_date) && window.start_date > toDate) continue;

    windows.push(Object.assign({}, window, {
      requester_email: lower_(row[idx.requester_email]),
      requester_name: String(row[idx.requester_name] || "").trim()
    }));
  }

  return { windows: windows };
}

function countBookedWindowsInRange_(bookedWindows, request) {
  const normalized = normalizeRequestWindow_(request);
  if (!normalized) return 0;

  let count = 0;
  const windows = Array.isArray(bookedWindows) ? bookedWindows : [];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    if (!window || window.dept !== normalized.dept) continue;
    if (rangesOverlap_(normalized.start_ms, normalized.end_ms, window.start_ms, window.end_ms)) {
      count++;
    }
  }
  return count;
}

function hasActiveBookedWindowForEmail_(bookedWindows, email, request) {
  const normalized = normalizeRequestWindow_(request);
  if (!normalized) return false;

  const targetEmail = lower_(email);
  if (!targetEmail) return false;

  const windows = Array.isArray(bookedWindows) ? bookedWindows : [];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    if (!window || window.dept !== normalized.dept) continue;
    if (window.requester_email !== targetEmail) continue;
    if (rangesOverlap_(normalized.start_ms, normalized.end_ms, window.start_ms, window.end_ms)) {
      return true;
    }
  }
  return false;
}

function getLatestBookerNameFromWindows_(bookedWindows, request) {
  const normalized = normalizeRequestWindow_(request);
  if (!normalized) return "";

  const windows = Array.isArray(bookedWindows) ? bookedWindows : [];
  for (let i = windows.length - 1; i >= 0; i--) {
    const window = windows[i];
    if (!window || window.dept !== normalized.dept) continue;
    if (!rangesOverlap_(normalized.start_ms, normalized.end_ms, window.start_ms, window.end_ms)) continue;
    return window.requester_name || window.requester_email || "";
  }
  return "";
}

function buildSessionBookingStats_(slots, bookedWindows) {
  const stats = Object.create(null);
  const windowsByDate = Object.create(null);
  const windows = Array.isArray(bookedWindows) ? bookedWindows : [];

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    if (!window || !window.start_date) continue;
    if (!windowsByDate[window.start_date]) windowsByDate[window.start_date] = [];
    windowsByDate[window.start_date].push(window);
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const slotWindow = normalizeRequestWindow_({
      dept: slot.dept,
      start_date: slot.date,
      start_time: slot.start_time,
      end_date: slot.date,
      end_time: slot.end_time
    });
    if (!slotWindow) {
      stats[slot.slot_id] = { booked_count: 0, latest_booker: "" };
      continue;
    }

    const dayWindows = windowsByDate[slot.date] || [];
    let bookedCount = 0;
    let latestBooker = "";

    for (let j = 0; j < dayWindows.length; j++) {
      const window = dayWindows[j];
      if (!window || window.dept !== slotWindow.dept) continue;
      if (!rangesOverlap_(slotWindow.start_ms, slotWindow.end_ms, window.start_ms, window.end_ms)) continue;
      bookedCount++;
      latestBooker = window.requester_name || window.requester_email || latestBooker;
    }

    stats[slot.slot_id] = {
      booked_count: bookedCount,
      latest_booker: latestBooker
    };
  }

  return stats;
}

function countBookedForRange_(ss, request) {
  const context = getBookedWindowsContext_(ss, {
    dept: request && request.dept,
    from_date: request && request.start_date,
    to_date: request && request.end_date
  });
  return countBookedWindowsInRange_(context.windows, request);
}

function hasActiveBookingForEmailInRange_(ss, email, request) {
  const context = getBookedWindowsContext_(ss, {
    dept: request && request.dept,
    from_date: request && request.start_date,
    to_date: request && request.end_date
  });
  return hasActiveBookedWindowForEmail_(context.windows, email, request);
}

function getLatestBookerNameForRange_(ss, request) {
  const context = getBookedWindowsContext_(ss, {
    dept: request && request.dept,
    from_date: request && request.start_date,
    to_date: request && request.end_date
  });
  return getLatestBookerNameFromWindows_(context.windows, request);
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

function validateBookingRequest_(ss, request, requesterEmail, context) {
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
  const bookingContext = context || {};
  const overrides = bookingContext.overrides || readSessionsAsOverrideMap_(ss);
  const bookedWindows = Array.isArray(bookingContext.bookedWindows)
    ? bookingContext.bookedWindows
    : getBookedWindowsContext_(ss, {
        dept: room,
        from_date: request.start_date,
        to_date: request.end_date
      }).windows;
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
    const bookedCount = countBookedWindowsInRange_(bookedWindows, {
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

  if (hasActiveBookedWindowForEmail_(bookedWindows, requesterEmail, request)) {
    return { ok: false, code: "FAIL_ALREADY_BOOKED", message: messageForFailCode_("FAIL_ALREADY_BOOKED"), statusCode: 409 };
  }

  if (countBookedWindowsInRange_(bookedWindows, request) > 0) {
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
    FAIL_MEET_DURATION_LIMIT: "Google Meet is limited to 1 hour on the current plan. Shorten the booking to 1 hour or keep it in-person only.",
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
