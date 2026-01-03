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

    const slotId = session.slot_id || session.slotid || "";
    window.selectedSession = {
      slot_id: slotId,
      slotid: slotId,
      date: session.date || "",
      start_time: session.start_time || session.starttime || "",
      end_time: session.end_time || session.endtime || ""
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
    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading ? "Booking..." : "Submit booking";
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

  function seatInfo(session) {
    const capacity = Number(session.capacity);
    const booked = Number(session.booked_count);
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

  function buildCard(session) {
    const seats = seatInfo(session);
    const status = sessionStatus(session, seats);

    const card = document.createElement("article");
    card.className = "tb-card tb-card--" + status;
    if (session.slot_id) {
      card.setAttribute("data-slot-id", session.slot_id);
    }

    const header = document.createElement("div");
    header.className = "tb-card-header";

    const dot = document.createElement("span");
    dot.className = "tb-status-dot tb-status-dot--" + status;
    dot.setAttribute("aria-hidden", "true");

    const dateEl = document.createElement("span");
    dateEl.className = "tb-date";
    dateEl.textContent = formatDateLabel(session.date);

    const timeEl = document.createElement("span");
    timeEl.className = "tb-time";
    timeEl.textContent = formatTimeRange(session.start_time, session.end_time);

    header.appendChild(dot);
    header.appendChild(dateEl);
    header.appendChild(timeEl);

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

    const meta = document.createElement("div");
    meta.className = "tb-meta";
    const reservedBy =
      session.reserved_by || session.reservedby || session.vendor || "";
    const isBooked = status === "full";
    if (isBooked) {
      const bookerName = reservedBy || "Unknown";
      card.setAttribute("title", "Booked by: " + bookerName);
    }
    const reservedRow = createMetaRow("Reserved by", reservedBy, {
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
      button.addEventListener("click", function () {
        openModal(session);
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
    sessions.forEach(function (session) {
      grid.appendChild(buildCard(session));
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
      const normalizedSessions = sessionsSource.map(function (session) {
        const copy = Object.assign({}, session);
        const reservedBy =
          copy.reserved_by || copy.reservedby || copy.vendor || "";
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

  function openModal(session) {
    if (!modal) {
      return;
    }
    if (session && session.date && selectedDate && session.date !== selectedDate) {
      setAlert("Select a session for the chosen date.", "error");
      return;
    }

    setSelectedSession(null);
    setSelectedSession(session);
    const selectedSession = window.selectedSession || {};

    if (slotIdInput) {
      slotIdInput.value = selectedSession.slot_id || "";
    }
    if (sessionSummary) {
      const reservedByLabel =
        session.reserved_by || session.reservedby || session.vendor || "";
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
  }

  function closeModal() {
    if (!modal) {
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
    const selectedSession = window.selectedSession || {};
    const slotId =
      (slotIdInput && slotIdInput.value.trim()) ||
      selectedSession.slot_id ||
      selectedSession.slotid ||
      "";
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
    const combinedNotes = rawNotes
      ? "Book Training Room - " + rawNotes
      : "Book Training Room";
    return {
      slot_id: slotId,
      requester_email: requesterEmail,
      requester_name: requesterName,
      notes: combinedNotes,
      user_type: resolvedUserType
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
    return "";
  }

  function markSessionBooked(slotId, requesterName) {
    if (!slotId) {
      return;
    }
    const sessionIndex = cachedSessions.findIndex(function (item) {
      return item && item.slot_id === slotId;
    });
    if (sessionIndex === -1) {
      return;
    }

    const reservedBy =
      requesterName ||
      cachedSessions[sessionIndex].reserved_by ||
      cachedSessions[sessionIndex].reservedby ||
      cachedSessions[sessionIndex].vendor ||
      "";
    const session = cachedSessions[sessionIndex];
    const capacity = Number(session.capacity);
    const bookedCount =
      !Number.isNaN(capacity) && capacity > 0 ? capacity : 1;
    const updatedSession = Object.assign({}, session, {
      vendor: reservedBy,
      reserved_by: reservedBy,
      reservedby: reservedBy,
      available: false,
      status: "full",
      capacity:
        !Number.isNaN(capacity) && capacity > 0 ? session.capacity : session.capacity || 1,
      booked_count: bookedCount
    });

    cachedSessions = cachedSessions.map(function (item, index) {
      return index === sessionIndex ? updatedSession : item;
    });

    renderSessions(cachedSessions);
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
        dept: ""
      });
      const apiError = apiErrorMessage(json);
      if (apiError) {
        throw new Error(apiError);
      }

      const bookingData = json && json.data ? json.data : json;
      const bookingId = bookingData && bookingData.booking_id;
      const isStaff = resolveUserType() === "staff";
      const agentLink =
        isStaff && bookingId
          ? {
              href:
                "/agent/search/1?query=" + encodeURIComponent(bookingId),
              label: "Find ticket in Zendesk"
            }
          : null;
      const message =
        "Booking confirmed." +
        (bookingId ? " Booking ID " + bookingId + "." : "") +
        " Zendesk ticket will be created automatically shortly.";
      setAlert(
        message,
        "success",
        agentLink ? { link: agentLink } : null
      );
      showBookingConfirmation(payload.requester_email);
      setTimeout(function () {
        closeModal();
        window.selectedDate = null;
        markSessionBooked(payload.slot_id, payload.requester_name);
        loadSessions({ preserveAlert: true });
      }, 2000);
    } catch (error) {
      const message = friendlyErrorMessage(error, "Booking failed.");
      setAlert(message, "error", {
        action: { label: "Retry", onClick: function () { submitBooking(); } }
      });
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

  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }
  if (modalCancel) {
    modalCancel.addEventListener("click", closeModal);
  }
  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeModal();
      }
    });
  }
  if (modalForm) {
    modalForm.addEventListener("submit", submitBooking);
  }

  loadSessions();
})();
