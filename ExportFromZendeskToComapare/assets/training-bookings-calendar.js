(function () {
  "use strict";

  // Booking widget notes:
  // - Uses runtime config with fallback via booking-config.js.
  // - Auto-detects user type (tenant/staff) from Digify segments.
  // - Attendees are fixed at 1; only notes are editable.
  // - "Reserved by" is set to the booker's name after booking.
  // - Zendesk ticket creation happens server-side (Apps Script).
  // - Single-date UI (no department/availability filters) with today's date defaulted.
  // - JSONP GET for sessions and bookings to avoid CORS.

  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/training_booking/.test(path)) {
    return;
  }

  const root = document.getElementById("training-booking-root");
  if (!root) {
    return;
  }

  const configProvider = window.DigifyBookingConfig;
  const config =
    configProvider && typeof configProvider.getConfig === "function"
      ? configProvider.getConfig(root)
      : { baseUrl: "", apiKey: "" };
  const baseUrl = (config.baseUrl || "").trim();
  const apiKey = config.apiKey || "";

  console.log("[training_booking] baseUrl", baseUrl);
  console.log("[training_booking] apiKey length", apiKey.length);

  // Core UI elements
  const alertEl = document.getElementById("training-booking-alert");
  const filtersForm = document.getElementById("training-booking-filters");
  const dateInput = document.getElementById("training-date");
  const loadButton = document.getElementById("training-load");
  const resetButton = document.getElementById("training-reset");
  const listWrap = document.getElementById("training-booking-list");
  const loadingEl = document.getElementById("training-booking-loading");

  const modal = document.getElementById("training-booking-modal");
  const modalClose = document.getElementById("training-booking-modal-close");
  const modalCancel = document.getElementById("training-booking-modal-cancel");
  const modalForm = document.getElementById("training-booking-form");
  const sessionSummary = document.getElementById("training-booking-session-summary");
  const slotIdInput = document.getElementById("training-booking-slot-id");
  const requesterNameInput = document.getElementById(
    "training-booking-requester-name"
  );
  const requesterEmailInput = document.getElementById(
    "training-booking-requester-email"
  );
  const notesInput = document.getElementById("training-booking-notes");
  const onlineToggle = document.getElementById("training-booking-online");
  const attendeesField = document.getElementById(
    "training-booking-attendees-field"
  );
  const attendeesWrap = document.getElementById("training-booking-attendees");
  const addAttendeeButton = document.getElementById(
    "training-booking-add-attendee"
  );
  const submitButton = document.getElementById("training-booking-submit");

  function getCurrentUser() {
    if (
      window.TRAINING_BOOKING_USER &&
      window.TRAINING_BOOKING_USER.isSignedIn
    ) {
      return {
        name: window.TRAINING_BOOKING_USER.name || "Unknown User",
        email: window.TRAINING_BOOKING_USER.email || "unknown@example.com"
      };
    }

    if (typeof HelpCenter !== "undefined" && HelpCenter.user) {
      return {
        name: HelpCenter.user.name || "Unknown User",
        email: HelpCenter.user.email || "unknown@example.com"
      };
    }

    const userMetaName = document.querySelector('meta[name="user-name"]');
    const userMetaEmail = document.querySelector('meta[name="user-email"]');

    if (userMetaName && userMetaEmail) {
      return {
        name: userMetaName.getAttribute("content") || "Unknown User",
        email: userMetaEmail.getAttribute("content") || "unknown@example.com"
      };
    }

    if (window.currentUser) {
      return {
        name: window.currentUser.name || "Unknown User",
        email: window.currentUser.email || "unknown@example.com"
      };
    }

    console.warn("[RoomBooking] Could not detect signed-in user");
    return {
      name: "Unknown User",
      email: "unknown@example.com"
    };
  }

  const user = getCurrentUser();
  const errorMessages = {
    FAIL_SLOT_FULL: "Sorry, this session is now full.",
    FAIL_ALREADY_BOOKED: "You have already booked this session.",
    FAIL_INVALID_SLOT: "This session is no longer available.",
    FAIL_CANCELLED: "This session has been cancelled.",
    UNAUTHORIZED: "API key not accepted."
  };

  const dateFormatter = new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Johannesburg"
  });
  const bookedAtFormatter = new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  let cachedSessions = [];
  let selectedDate = "";
  let userType = "";
  window.selectedSession = null;

  function resolveUserType() {
    const segments = window.DigifySegments || window.DigifiedSegments || {};
    const isTenant =
      segments.isTenantUser === true ||
      window.isTenantUser === true ||
      document.documentElement.classList.contains("hc-tenant-user");
    return isTenant ? "tenant" : "staff";
  }

  function setSelectedSession(session) {
    if (!session) {
      window.selectedSession = null;
      return;
    }

    const normalized = normalizeSlot(session);
    if (!normalized) {
      window.selectedSession = null;
      return;
    }

    const slotId = normalized.slot_id || normalized.slotid || "";
    window.selectedSession = {
      slot_id: slotId,
      slotid: slotId,
      date: normalized.date || "",
      start_time: normalized.start_time || "",
      end_time: normalized.end_time || ""
    };
  }

  function ensureConfig() {
    if (!baseUrl || !apiKey) {
      throw new Error(
        "Training booking is not configured. Please contact an admin."
      );
    }
  }

  function buildApiUrl(action, params) {
    if (!baseUrl) {
      return "";
    }

    let url;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      return "";
    }

    if (action) {
      url.searchParams.set("action", action);
    }
    if (apiKey) {
      url.searchParams.set("api_key", apiKey);
    }
    if (params) {
      Object.keys(params).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
          const value = params[key];
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
          }
        }
      });
    }

    return url.toString();
  }

  function jsonpRequest(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName =
        "calApiJsonpCb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const callbackIsValid = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(callbackName);
      if (!callbackIsValid) {
        reject(new Error("Invalid JSONP callback name."));
        return;
      }
      const url = buildApiUrl(
        action,
        Object.assign({}, params, {
          callback: callbackName,
          _ts: Date.now()
        })
      );

      if (!url) {
        reject(new Error("Training API URL is invalid."));
        return;
      }

      const script = document.createElement("script");
      let timeoutId = null;

      function cleanup() {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };

      script.onerror = function () {
        cleanup();
        reject(new Error("JSONP request failed."));
      };

      timeoutId = setTimeout(function () {
        cleanup();
        reject(new Error("JSONP request timed out."));
      }, 10000);

      script.src = url;
      (document.head || document.body).appendChild(script);
    });
  }

  function apiErrorMessage(json) {
    if (!json || typeof json !== "object") {
      return "";
    }

    const statusCode = Number(json.statusCode);
    const hasStatus = !Number.isNaN(statusCode) && statusCode !== 0;
    const isError = json.success === false || (hasStatus && statusCode !== 200);

    if (!isError) {
      return "";
    }

    const code = json.code ? String(json.code) : "";
    if (code && errorMessages[code]) {
      return errorMessages[code];
    }

    const message = json.message ? String(json.message) : "Request failed.";
    if (code) {
      return code + ": " + message;
    }
    if (hasStatus) {
      return message + " (status " + statusCode + ")";
    }
    return message;
  }

  function friendlyErrorMessage(error, fallback) {
    const message = error && error.message ? String(error.message) : "";
    if (
      message === "JSONP request timed out." ||
      message === "JSONP request failed."
    ) {
      return "Unable to reach the training API. Please try again.";
    }
    return message || fallback;
  }

  // Status messaging
  function setAlert(message, type, options) {
    if (!alertEl) {
      return;
    }

    alertEl.className = "tb-alert";
    if (type) {
      alertEl.classList.add("tb-alert--" + type);
    }
    alertEl.innerHTML = "";
    const textNode = document.createElement("span");
    textNode.textContent = message;
    alertEl.appendChild(textNode);

    if (options && options.link && options.link.href && options.link.label) {
      const spacer = document.createTextNode(" ");
      const anchor = document.createElement("a");
      anchor.href = options.link.href;
      anchor.textContent = options.link.label;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      alertEl.appendChild(spacer);
      alertEl.appendChild(anchor);
    }
    if (
      options &&
      options.action &&
      options.action.label &&
      typeof options.action.onClick === "function"
    ) {
      const spacer = document.createTextNode(" ");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary tb-alert-action";
      button.textContent = options.action.label;
      button.addEventListener("click", options.action.onClick);
      alertEl.appendChild(spacer);
      alertEl.appendChild(button);
    }
    alertEl.hidden = false;
  }

  function clearAlert() {
    if (!alertEl) {
      return;
    }

    alertEl.textContent = "";
    alertEl.hidden = true;
    alertEl.className = "tb-alert";
  }

  function setLoading(isLoading) {
    if (loadingEl) {
      loadingEl.hidden = !isLoading;
    }
    if (loadButton) {
      loadButton.disabled = isLoading;
      loadButton.textContent = isLoading ? "Refreshing..." : "Refresh";
    }
  }

  function setBookingLoading(isLoading) {
    if (!submitButton) {
      return;
    }
    if (isLoading) {
      submitButton.disabled = true;
      submitButton.textContent = "Booking...";
      submitButton.classList.add("tb-btn--loading");
      return;
    }
    submitButton.classList.remove("tb-btn--loading");
  }

  function resetSubmitButtonState() {
    if (!submitButton) {
      return;
    }
    submitButton.disabled = false;
    submitButton.textContent = "Book now";
    submitButton.classList.remove(
      "tb-btn--loading",
      "tb-btn--booked",
      "tb-btn--error",
      "tb-btn--success",
      "booked",
      "disabled",
      "success",
      "loading",
      "error"
    );
  }

  function clearAttendeeInputs() {
    if (!attendeesWrap) {
      return;
    }
    attendeesWrap.innerHTML = "";
  }

  function addAttendeeInput(value) {
    if (!attendeesWrap) {
      return null;
    }
    const count = attendeesWrap.querySelectorAll("input").length + 1;
    const input = document.createElement("input");
    input.type = "email";
    input.name = "attendee_emails[]";
    input.className = "form-control";
    input.placeholder = "Attendee email";
    input.autocomplete = "email";
    input.inputMode = "email";
    input.setAttribute("aria-label", "Attendee email " + count);
    if (count === 1) {
      input.id = "training-booking-attendee-1";
    }
    if (value) {
      input.value = value;
    }
    attendeesWrap.appendChild(input);
    return input;
  }

  function setAttendeeFieldsVisible(isVisible) {
    if (!attendeesField) {
      return;
    }
    attendeesField.hidden = !isVisible;
    if (!isVisible) {
      clearAttendeeInputs();
      return;
    }
    if (attendeesWrap && attendeesWrap.querySelectorAll("input").length === 0) {
      addAttendeeInput();
    }
  }

  function getAttendeeEmails() {
    if (!attendeesWrap) {
      return [];
    }
    return Array.from(attendeesWrap.querySelectorAll("input"))
      .map(function (input) {
        return String(input.value || "").trim();
      })
      .filter(Boolean);
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
  }

  function normalizeMeetingType(value) {
    if (value === true) {
      return "online";
    }
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
      return "";
    }
    if (raw === "online" || raw === "virtual" || raw === "remote") {
      return "online";
    }
    if (
      raw === "in_person" ||
      raw === "in-person" ||
      raw === "in person" ||
      raw === "onsite"
    ) {
      return "in_person";
    }
    return raw;
  }

  function normalizeAttendeeEmails(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value
        .map(function (item) {
          return String(item || "").trim();
        })
        .filter(Boolean);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      if (trimmed[0] === "[" && trimmed[trimmed.length - 1] === "]") {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed
              .map(function (item) {
                return String(item || "").trim();
              })
              .filter(Boolean);
          }
        } catch (error) {
          // Fall through to delimiter parsing.
        }
      }
      return trimmed
        .split(/[;,]/)
        .map(function (item) {
          return String(item || "").trim();
        })
        .filter(Boolean);
    }
    return [];
  }

  function toIsoDate(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function getSastDate() {
    const formatter = new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = formatter.formatToParts(new Date());
    const lookup = {};
    parts.forEach(function (part) {
      lookup[part.type] = part.value;
    });
    const year = Number(lookup.year);
    const month = Number(lookup.month);
    const day = Number(lookup.day);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function setDefaultDates() {
    if (!dateInput) {
      return;
    }

    const today = getSastDate();
    const todayValue = toIsoDate(today);
    dateInput.value = todayValue;
    selectedDate = todayValue;
    window.selectedDate = todayValue;
  }

  function getSelectedDate() {
    if (!dateInput) {
      return "";
    }
    return dateInput.value;
  }

  function parseDateParts(value) {
    if (!value) {
      return null;
    }
    const parts = value.split("-");
    if (parts.length !== 3) {
      return null;
    }
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) {
      return null;
    }
    return { year: year, month: month, day: day };
  }

  function formatDateLabel(value) {
    const parts = parseDateParts(value);
    if (!parts) {
      return value || "";
    }
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return dateFormatter.format(date);
  }

  function to12Hour(value) {
    if (!value) {
      return "";
    }
    const parts = value.split(":");
    const hour = Number(parts[0]);
    const minutes = parts[1] || "00";
    if (Number.isNaN(hour)) {
      return value;
    }
    const period = hour >= 12 ? "PM" : "AM";
    const adjusted = hour % 12 === 0 ? 12 : hour % 12;
    return adjusted + ":" + minutes + " " + period;
  }

  function formatTimeRange(start, end) {
    if (start && end) {
      return to12Hour(start) + " - " + to12Hour(end) + " SAST";
    }
    const single = to12Hour(start || end || "");
    return single ? single + " SAST" : "";
  }

  function formatBookedAt(value) {
    if (!value) {
      return "";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    return bookedAtFormatter.format(parsed);
  }

  function normalizeSlot(slot) {
    if (!slot || typeof slot !== "object") {
      return null;
    }

    const dateValue = slot.date || "";
    const startTimeRaw = slot.start_time || slot.starttime || slot.from || "";
    const endTimeRaw = slot.end_time || slot.endtime || slot.to || "";
    const startTime = startTimeRaw ? String(startTimeRaw) : "";
    const endTime = endTimeRaw ? String(endTimeRaw) : "";
    const slotId =
      slot.slot_id ||
      slot.slotid ||
      (dateValue && startTime
        ? `SLOT_${dateValue}_${startTime.replace(":", "")}`.toUpperCase()
        : null);

    const statusValue = String(slot.status || "").toLowerCase();
    const booked =
      slot.booked === true ||
      slot.available === false ||
      statusValue === "full";

    const bookerName =
      slot.booker_name || slot.reserved_by || slot.reservedby || slot.vendor || null;

    const bookedAt = slot.booked_at || slot.bookedAt || null;
    const meetingType = normalizeMeetingType(
      slot.meeting_type ||
        slot.meetingType ||
        slot.meeting ||
        (slot.online_meeting === true ? "online" : "")
    );
    const attendeeEmails = normalizeAttendeeEmails(
      slot.attendee_emails ||
        slot.attendeeEmails ||
        slot.attendees ||
        slot.attendee_email ||
        slot.attendeeEmail ||
        ""
    );

    return Object.assign({}, slot, {
      slot_id: slotId,
      date: dateValue || slot.date || "",
      start_time: startTime,
      end_time: endTime,
      booked: booked,
      booker_name: bookerName,
      booked_at: bookedAt,
      meeting_type: meetingType,
      attendee_emails: attendeeEmails
    });
  }

  function seatInfo(session) {
    const capacity = Number(session.capacity);
    const bookedRaw =
      session.booked_count !== undefined
        ? session.booked_count
        : session.bookedcount !== undefined
          ? session.bookedcount
          : session.bookedCount !== undefined
            ? session.bookedCount
            : session.booked;
    let booked = Number(bookedRaw);
    if (Number.isNaN(booked) && !Number.isNaN(capacity)) {
      if (session.booked === true) {
        booked = capacity;
      } else if (session.booked === false) {
        booked = 0;
      }
    }
    if (Number.isNaN(capacity) || Number.isNaN(booked)) {
      return { capacity: null, booked: null, remaining: null };
    }
    const remaining = Math.max(capacity - booked, 0);
    return { capacity: capacity, booked: booked, remaining: remaining };
  }

  function sessionStatus(session, seats) {
    const status = String(session.status || "").toLowerCase();
    if (status === "cancelled") {
      return "cancelled";
    }
    if (session.booked === true || status === "full") {
      return "full";
    }
    if (seats.capacity !== null && seats.booked !== null) {
      if (seats.booked >= seats.capacity) {
        return "full";
      }
    }
    if (session.available === false) {
      return "full";
    }
    return "open";
  }

  function statusLabel(status) {
    if (status === "cancelled") {
      return "Cancelled";
    }
    if (status === "full") {
      return "Full";
    }
    return "Available";
  }

  function createMetaRow(label, value, options) {
    const allowBlank = options && options.allowBlank;
    const row = document.createElement("div");
    row.className = "tb-meta-row";

    const labelEl = document.createElement("span");
    labelEl.className = "tb-meta-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    valueEl.className = "tb-meta-value";
    valueEl.textContent = allowBlank ? value || "" : value || "n/a";

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  function renderPlaceholder(message) {
    if (!listWrap) {
      return;
    }
    listWrap.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "tb-placeholder";
    placeholder.textContent = message;
    listWrap.appendChild(placeholder);
  }

  function buildCard(session, index) {
    const seats = seatInfo(session);
    const status = sessionStatus(session, seats);
    const isBooked = session.booked === true || status === "full";
    const meetingType = normalizeMeetingType(
      session.meeting_type ||
        session.meetingType ||
        session.meeting ||
        (session.online_meeting === true ? "online" : "")
    );
    const attendeeEmails = normalizeAttendeeEmails(
      session.attendee_emails ||
        session.attendeeEmails ||
        session.attendees ||
        session.attendee_email ||
        session.attendeeEmail ||
        ""
    );

    const card = document.createElement("article");
    card.className = "tb-card tb-card--" + status;
    card.classList.add("slot-card");
    card.classList.add(isBooked ? "is-booked" : "is-open");
    if (meetingType === "online") {
      card.classList.add("tb-card--online");
    }
    if (typeof index === "number") {
      const delay = Math.min(index * 40, 200);
      card.style.setProperty("--tb-card-delay", `${delay}ms`);
    }
    if (session.slot_id) {
      card.setAttribute("data-slot-id", session.slot_id);
    }

    const header = document.createElement("div");
    header.className = "tb-card-header";

    const dot = document.createElement("span");
    dot.className = "tb-status-dot tb-status-dot--" + status;
    if (meetingType === "online") {
      dot.classList.add("tb-status-dot--online");
    }
    dot.setAttribute("aria-hidden", "true");

    const dateEl = document.createElement("span");
    dateEl.className = "tb-date";
    dateEl.textContent = formatDateLabel(session.date);

    const timeEl = document.createElement("span");
    timeEl.className = "tb-time";
    timeEl.textContent = formatTimeRange(session.start_time, session.end_time);

    header.appendChild(dot);
    const dateWrap = document.createElement("div");
    dateWrap.className = "tb-date-wrap";
    const dateIcon = document.createElement("span");
    dateIcon.className = "tb-icon tb-icon--date";
    dateIcon.setAttribute("aria-hidden", "true");
    dateWrap.appendChild(dateIcon);
    dateWrap.appendChild(dateEl);

    const timeWrap = document.createElement("div");
    timeWrap.className = "tb-time-wrap";
    const timeIcon = document.createElement("span");
    timeIcon.className = "tb-icon tb-icon--time";
    timeIcon.setAttribute("aria-hidden", "true");
    timeWrap.appendChild(timeIcon);
    timeWrap.appendChild(timeEl);

    header.appendChild(dateWrap);
    header.appendChild(timeWrap);

    const body = document.createElement("div");
    body.className = "tb-card-body";

    const topic = document.createElement("h3");
    topic.className = "tb-topic";
    topic.textContent = "Training Session";

    const badges = document.createElement("div");
    badges.className = "tb-badges";

    const statusBadge = document.createElement("span");
    statusBadge.className = "tb-status-badge tb-status-badge--" + status;
    statusBadge.textContent = statusLabel(status);
    badges.appendChild(statusBadge);
    if (meetingType === "online") {
      const meetingBadge = document.createElement("span");
      meetingBadge.className = "tb-status-badge tb-status-badge--online";
      meetingBadge.textContent = "Online";
      badges.appendChild(meetingBadge);
    }

    const meta = document.createElement("div");
    meta.className = "tb-meta";
    const bookerName =
      session.booker_name ||
      session.reserved_by ||
      session.reservedby ||
      session.vendor ||
      "";
    const bookedAt = session.booked_at || session.bookedAt || "";
    const bookedAtLabel = formatBookedAt(bookedAt);
    card.setAttribute("data-booker-name", bookerName || "");
    card.setAttribute("data-booked-at", bookedAt || "");
    const reservedRow = createMetaRow("Reserved by", bookerName, {
      allowBlank: true
    });
    reservedRow.classList.add("tb-meta-row--reserved");
    meta.appendChild(reservedRow);

    let seatsText = "n/a";
    if (seats.capacity !== null && seats.remaining !== null) {
      seatsText =
        seats.remaining + " of " + seats.capacity + " spots remaining";
    }
    meta.appendChild(createMetaRow("Availability", seatsText));

    const progress = document.createElement("div");
    progress.className = "tb-progress";
    const progressTrack = document.createElement("div");
    progressTrack.className = "tb-progress__track";
    const progressBar = document.createElement("div");
    progressBar.className = "tb-progress__bar tb-progress__bar--" + status;
    const progressRatio =
      seats.capacity && seats.booked !== null && seats.capacity > 0
        ? Math.min(seats.booked / seats.capacity, 1)
        : 0;
    progressBar.style.setProperty("--tb-progress", progressRatio);
    progressTrack.appendChild(progressBar);
    const progressLabel = document.createElement("span");
    progressLabel.className = "tb-progress__label";
    progressLabel.textContent =
      seats.capacity !== null && seats.booked !== null
        ? `${seats.booked} of ${seats.capacity} booked`
        : "Availability pending";
    progress.appendChild(progressTrack);
    progress.appendChild(progressLabel);
    meta.appendChild(progress);

    const statusRow = createMetaRow("Status", statusLabel(status));
    meta.appendChild(statusRow);

    body.appendChild(topic);
    body.appendChild(badges);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "tb-card-actions";

    if (status === "open" && session.slot_id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-primary";
      button.textContent = "Book Now";
      button.dataset.slotId = session.slot_id;
      button.dataset.date = session.date || "";
      button.dataset.startTime = session.start_time || "";
      button.dataset.endTime = session.end_time || "";
      button.addEventListener("click", function (event) {
        const target = event.currentTarget;
        openBookingModal({
          slot_id: target.dataset.slotId,
          date: target.dataset.date,
          start_time: target.dataset.startTime,
          end_time: target.dataset.endTime
        });
      });
      actions.appendChild(button);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-primary";
      button.textContent = "Book Now";
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      actions.appendChild(button);
    }

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);
    const hasTooltipInfo =
      !!bookerName || !!bookedAtLabel || attendeeEmails.length > 0;
    if (isBooked && hasTooltipInfo) {
      const tooltip = document.createElement("div");
      tooltip.className = "slot-tooltip";

      if (bookerName) {
        const tooltipTitle = document.createElement("div");
        tooltipTitle.className = "slot-tooltip-title";
        tooltipTitle.textContent = "Reserved by";
        tooltip.appendChild(tooltipTitle);

        const tooltipName = document.createElement("div");
        tooltipName.className = "slot-tooltip-name";
        tooltipName.textContent = bookerName;
        tooltip.appendChild(tooltipName);
      }

      if (bookedAtLabel) {
        const tooltipTime = document.createElement("div");
        tooltipTime.className = "slot-tooltip-time";
        tooltipTime.textContent = bookedAtLabel;
        tooltip.appendChild(tooltipTime);
      }

      if (attendeeEmails.length) {
        const tooltipAtt = document.createElement("div");
        tooltipAtt.className = "slot-tooltip-item";
        tooltipAtt.textContent =
          "Attendees: " + attendeeEmails.join(", ");
        tooltip.appendChild(tooltipAtt);
      }

      card.appendChild(tooltip);
    }
    return card;
  }

  function renderSessions(sessions) {
    if (!listWrap) {
      return;
    }

    if (!sessions.length) {
      renderPlaceholder("No sessions available for this date.");
      return;
    }

    listWrap.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "tb-grid";
    sessions.forEach(function (session, index) {
      grid.appendChild(buildCard(session, index));
    });
    listWrap.appendChild(grid);
  }

  // Sessions flow
  async function loadSessions(options) {
    const preserveAlert = options && options.preserveAlert;
    if (!preserveAlert) {
      clearAlert();
    }

    try {
      ensureConfig();
    } catch (error) {
      setAlert(error.message, "error");
      return;
    }

    selectedDate = getSelectedDate();
    if (!selectedDate) {
      setAlert("Select a valid date.", "error");
      return;
    }

    setLoading(true);
    try {
      const json = await jsonpRequest("sessions", {
        from: selectedDate,
        to: selectedDate
      });
      const apiError = apiErrorMessage(json);
      if (apiError) {
        throw new Error(apiError);
      }
      const sessionsSource =
        json && json.data && Array.isArray(json.data.sessions)
          ? json.data.sessions
          : json && json.data && Array.isArray(json.data.slots)
            ? json.data.slots
            : [];
      const normalizedSessions = sessionsSource
        .map(normalizeSlot)
        .filter(function (session) {
          return session;
        })
        .map(function (session) {
          const copy = Object.assign({}, session);
          const reservedBy =
            copy.booker_name ||
            copy.reserved_by ||
            copy.reservedby ||
            copy.vendor ||
            "";
          if (reservedBy && !copy.booker_name) {
            copy.booker_name = reservedBy;
          }
          if (reservedBy && !copy.reserved_by) {
            copy.reserved_by = reservedBy;
          }
          if (reservedBy && !copy.vendor) {
            copy.vendor = reservedBy;
          }
          return copy;
        });
      cachedSessions = normalizedSessions
        .filter(function (session) {
          return session && session.date === selectedDate;
        })
        .sort(function (a, b) {
          const aKey = (a.start_time || "") + " " + (a.end_time || "");
          const bKey = (b.start_time || "") + " " + (b.end_time || "");
          return aKey.localeCompare(bKey);
        });
      renderSessions(cachedSessions);
    } catch (error) {
      if (preserveAlert) {
        console.warn("[training_booking] Session refresh failed:", error);
        return;
      }
      const message = friendlyErrorMessage(error, "Unable to load sessions.");
      setAlert(message, "error", {
        action: { label: "Retry", onClick: loadSessions }
      });
    } finally {
      setLoading(false);
    }
  }

  function openBookingModal(session) {
    window.selectedSession = session;

    // Reset submit button state before showing the modal.
    resetSubmitButtonState();

    if (!modal) {
      return;
    }
    if (session && session.date && selectedDate && session.date !== selectedDate) {
      setAlert("Select a session for the chosen date.", "error");
      return;
    }

    resetBookingForm();

    const normalizedSlot = normalizeSlot(session);
    if (!normalizedSlot || !normalizedSlot.slot_id) {
      setAlert("Please select a session.", "error");
      return;
    }
    setSelectedSession(null);
    setSelectedSession(normalizedSlot);
    const selectedSession = window.selectedSession || {};

    if (slotIdInput) {
      slotIdInput.value = selectedSession.slot_id || "";
    }
    if (sessionSummary) {
      const reservedByLabel =
        (normalizedSlot && normalizedSlot.booker_name) ||
        (normalizedSlot && normalizedSlot.reserved_by) ||
        (normalizedSlot && normalizedSlot.reservedby) ||
        (normalizedSlot && normalizedSlot.vendor) ||
        "";
      sessionSummary.textContent =
        formatDateLabel(selectedSession.date) +
        " | " +
        formatTimeRange(selectedSession.start_time, selectedSession.end_time) +
        " | " +
        "Training Session" +
        (reservedByLabel
          ? " | Reserved by " + reservedByLabel
          : "");
    }

    const currentUser = getCurrentUser();

    console.log("[RoomBooking] Opening modal for user:", {
      name: currentUser.name,
      email: currentUser.email
    });

    if (requesterNameInput) {
      requesterNameInput.value = currentUser.name;
      requesterNameInput.setAttribute("readonly", true);
      requesterNameInput.style.backgroundColor = "#f5f5f5";
      requesterNameInput.style.cursor = "not-allowed";
    }
    if (requesterEmailInput) {
      requesterEmailInput.value = currentUser.email;
      requesterEmailInput.setAttribute("readonly", true);
      requesterEmailInput.style.backgroundColor = "#f5f5f5";
      requesterEmailInput.style.cursor = "not-allowed";
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("tb-modal-open");
  }

  function showBookingConfirmation(requesterEmail) {
    if (!modal || !modalForm) {
      return;
    }

    modalForm.style.display = "none";

    let confirmation = modal.querySelector(".tb-booking-confirmation");
    if (!confirmation) {
      confirmation = document.createElement("div");
      confirmation.className = "tb-booking-confirmation";
      modalForm.parentNode.insertBefore(confirmation, modalForm);
    }

    const emailText = requesterEmail || "your email";
    confirmation.innerHTML =
      '<div class="tb-booking-confirmation__body">' +
      "<h2>You've Booked!</h2>" +
      "<p>Your training room session has been confirmed.</p>" +
      '<p class="tb-booking-confirmation__note">A confirmation email has been sent to <strong>' +
      emailText +
      "</strong>.</p>" +
      "</div>";
  }

  function resetBookingForm() {
    if (!modalForm) {
      return;
    }

    modalForm.reset();
    const confirmation = modal.querySelector(".tb-booking-confirmation");
    if (confirmation) {
      confirmation.remove();
    }

    modalForm.style.display = "";

    if (slotIdInput) {
      slotIdInput.value = "";
    }
    if (sessionSummary) {
      sessionSummary.textContent = "";
    }
    if (notesInput) {
      notesInput.value = "";
    }
    if (onlineToggle) {
      onlineToggle.checked = false;
    }
    setAttendeeFieldsVisible(false);

    const currentUser = getCurrentUser();
    if (requesterNameInput) {
      requesterNameInput.value = currentUser.name;
      requesterNameInput.setAttribute("readonly", true);
      requesterNameInput.style.backgroundColor = "#f5f5f5";
      requesterNameInput.style.cursor = "not-allowed";
    }
    if (requesterEmailInput) {
      requesterEmailInput.value = currentUser.email;
      requesterEmailInput.setAttribute("readonly", true);
      requesterEmailInput.style.backgroundColor = "#f5f5f5";
      requesterEmailInput.style.cursor = "not-allowed";
    }
    resetSubmitButtonState();
  }

  function closeBookingModal() {
    resetSubmitButtonState();

    if (!modal) {
      window.selectedSession = null;
      return;
    }
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("tb-modal-open");
    window.selectedSession = null;
    resetBookingForm();
  }

  function buildBookingPayload() {
    const currentUser = getCurrentUser();
    const slotId = slotIdInput ? slotIdInput.value.trim() : "";
    const requesterName =
      (requesterNameInput && requesterNameInput.value.trim()) ||
      currentUser.name ||
      "Zendesk User";
    const requesterEmail =
      (requesterEmailInput && requesterEmailInput.value.trim()) ||
      currentUser.email ||
      "unknown@example.com";
    const resolvedUserType = resolveUserType();
    userType = resolvedUserType;
    const rawNotes = notesInput ? notesInput.value.trim() : "";
    const onlineMeeting = !!(onlineToggle && onlineToggle.checked);
    const meetingType = onlineMeeting ? "online" : "in_person";
    const attendeeEmails = onlineMeeting ? getAttendeeEmails() : [];
    let combinedNotes = rawNotes
      ? "Book Training Room - " + rawNotes
      : "Book Training Room";
    return {
      slot_id: slotId,
      requester_email: requesterEmail,
      requester_name: requesterName,
      notes: combinedNotes,
      user_type: resolvedUserType,
      meeting_type: meetingType,
      attendee_emails: attendeeEmails
    };
  }

  function validatePayload(payload) {
    if (!payload.slot_id) {
      return "Please select a session.";
    }
    if (!payload.requester_name) {
      return "Requester name is required.";
    }
    if (!payload.requester_email) {
      return "Requester email is required.";
    }
    if (!payload.user_type) {
      return "User type is not available.";
    }
    if (payload.meeting_type === "online") {
      if (
        !Array.isArray(payload.attendee_emails) ||
        payload.attendee_emails.length === 0
      ) {
        return "Please add at least one attendee email for online meetings.";
      }
      const invalidEmail = payload.attendee_emails.find(function (email) {
        return !isValidEmail(email);
      });
      if (invalidEmail) {
        return "Please enter valid attendee email addresses.";
      }
    }
    return "";
  }

  function markSessionBooked(slotId, requesterName, meetingType, attendeeEmails) {
    if (!slotId) {
      return;
    }
    const sessionIndex = cachedSessions.findIndex(function (item) {
      return item && item.slot_id === slotId;
    });
    if (sessionIndex === -1) {
      return;
    }

    const session = cachedSessions[sessionIndex];
    const existingBookerName =
      session.booker_name ||
      session.reserved_by ||
      session.reservedby ||
      session.vendor ||
      "";
    const reservedBy = requesterName || existingBookerName || "";
    const capacity = Number(session.capacity);
    const bookedCount =
      !Number.isNaN(capacity) && capacity > 0 ? capacity : 1;
    const normalizedMeetingType = normalizeMeetingType(
      meetingType ||
        session.meeting_type ||
        session.meetingType ||
        session.meeting ||
        (session.online_meeting === true ? "online" : "")
    );
    const attendeeSource =
      Array.isArray(attendeeEmails) && attendeeEmails.length > 0
        ? attendeeEmails
        : session.attendee_emails ||
          session.attendeeEmails ||
          session.attendees ||
          "";
    const normalizedAttendees = normalizeAttendeeEmails(attendeeSource);
    const updatedSession = Object.assign({}, session, {
      booker_name: existingBookerName || reservedBy || "",
      booked_at: session.booked_at || new Date().toISOString(),
      booked: true,
      vendor: session.vendor || reservedBy,
      reserved_by: session.reserved_by || reservedBy,
      reservedby: session.reservedby || reservedBy,
      available: false,
      status: "full",
      capacity:
        !Number.isNaN(capacity) && capacity > 0 ? session.capacity : session.capacity || 1,
      booked_count: bookedCount,
      meeting_type: normalizedMeetingType || session.meeting_type || "",
      attendee_emails: normalizedAttendees
    });

    cachedSessions = cachedSessions.map(function (item, index) {
      return index === sessionIndex ? updatedSession : item;
    });

    renderSessions(cachedSessions);
  }

  function handleBookingResponse(response, payload) {
    const apiError = apiErrorMessage(response);
    if (apiError) {
      setAlert(apiError, "error");
      return { ok: false, message: apiError };
    }

    const bookingData = response && response.data ? response.data : response;
    const bookingId = bookingData && bookingData.booking_id;
    const isStaff = resolveUserType() === "staff";
    const agentLink =
      isStaff && bookingId
        ? {
            href: "/agent/search/1?query=" + encodeURIComponent(bookingId),
            label: "Find ticket in Zendesk"
          }
        : null;
    const message =
      "Booking confirmed." +
      (bookingId ? " Booking ID " + bookingId + "." : "") +
      " Zendesk ticket will be created automatically shortly.";
    setAlert(message, "success", agentLink ? { link: agentLink } : null);

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Booked";
      submitButton.classList.add("tb-btn--booked");
      submitButton.classList.remove("tb-btn--loading");
    }

    showBookingConfirmation(payload ? payload.requester_email : "");
    return { ok: true, bookingId: bookingId };
  }

  // Booking flow
  async function submitBooking(event) {
    if (event) {
      event.preventDefault();
    }

    clearAlert();
    try {
      ensureConfig();
    } catch (error) {
      setAlert(error.message, "error");
      return;
    }

    const payload = buildBookingPayload();
    console.log("[RoomBooking] Submitting booking:", {
      slot_id: payload.slot_id,
      requester_name: payload.requester_name,
      requester_email: payload.requester_email
    });
    const validation = validatePayload(payload);
    if (validation) {
      setAlert(validation, "error");
      return;
    }

    setBookingLoading(true);
    try {
      const json = await jsonpRequest("book", {
        slot_id: payload.slot_id,
        requester_name: payload.requester_name,
        requester_email: payload.requester_email,
        user_type: payload.user_type,
        notes: payload.notes,
        meeting_type: payload.meeting_type,
        attendee_emails: Array.isArray(payload.attendee_emails)
          ? payload.attendee_emails.join(",")
          : payload.attendee_emails,
        dept: ""
      });
      const result = handleBookingResponse(json, payload);
      if (!result.ok) {
        resetSubmitButtonState();
        return;
      }
      setTimeout(function () {
        closeBookingModal();
        markSessionBooked(
          payload.slot_id,
          payload.requester_name,
          payload.meeting_type,
          payload.attendee_emails
        );
        loadSessions({ preserveAlert: true });
      }, 2000);
    } catch (error) {
      const message = friendlyErrorMessage(error, "Booking failed.");
      setAlert(message, "error", {
        action: { label: "Retry", onClick: function () { submitBooking(); } }
      });
      resetSubmitButtonState();
    } finally {
      setBookingLoading(false);
    }
  }

  function logUserDiagnostics() {
    console.log("[RoomBooking] Checking user sources...");
    console.log(
      "  HelpCenter.user:",
      typeof HelpCenter !== "undefined" ? HelpCenter.user : "undefined"
    );
    console.log("  window.currentUser:", window.currentUser);
    console.log("  window.TRAINING_BOOKING_USER:", window.TRAINING_BOOKING_USER);
    console.log("[RoomBooking] Resolved user:", getCurrentUser());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", logUserDiagnostics);
  } else {
    logUserDiagnostics();
  }

  userType = resolveUserType();
  setDefaultDates();
  renderPlaceholder("Loading sessions...");

  if (loadButton) {
    loadButton.style.display = "none";
  }

  const initialUser = getCurrentUser();
  if (requesterNameInput && initialUser.name) {
    requesterNameInput.value = initialUser.name;
  }
  if (requesterEmailInput && initialUser.email) {
    requesterEmailInput.value = initialUser.email;
  }

  if (filtersForm) {
    filtersForm.addEventListener("submit", function (event) {
      event.preventDefault();
      loadSessions();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", function () {
      if (filtersForm) {
        filtersForm.reset();
      }
      setDefaultDates();
      cachedSessions = [];
      clearAlert();
      loadSessions();
    });
  }

  if (dateInput) {
    dateInput.addEventListener("change", function () {
      selectedDate = getSelectedDate();
      window.selectedDate = selectedDate;
      loadSessions();
    });
  }

  if (onlineToggle) {
    onlineToggle.addEventListener("change", function () {
      setAttendeeFieldsVisible(onlineToggle.checked);
    });
  }
  if (addAttendeeButton) {
    addAttendeeButton.addEventListener("click", function () {
      if (!onlineToggle || !onlineToggle.checked) {
        return;
      }
      addAttendeeInput();
    });
  }

  if (modalClose) {
    modalClose.addEventListener("click", closeBookingModal);
  }
  if (modalCancel) {
    modalCancel.addEventListener("click", closeBookingModal);
  }
  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeBookingModal();
      }
    });
  }
  if (modalForm && !modalForm.dataset.bound) {
    modalForm.addEventListener("submit", submitBooking);
    modalForm.dataset.bound = "1";
  }

  loadSessions();
})();
