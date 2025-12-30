(function () {
  "use strict";

  // Booking widget notes:
  // - Uses runtime config from TRAINING_BOOKING_CFG, data attributes, or theme settings.
  // - Auto-detects user type (tenant/staff) from Digify segments.
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

  const helpCenter = window.HelpCenter || {};
  const settings = helpCenter.themeSettings || {};
  // Config block: allow injection via window config, data attributes, or theme settings.
  const cfg = window.TRAINING_BOOKING_CFG || {};
  const rootCfg = {
    baseUrl: root.getAttribute("data-training-base-url") || "",
    apiKey: root.getAttribute("data-training-api-key") || ""
  };
  const baseUrl = (
    cfg.baseUrl ||
    rootCfg.baseUrl ||
    settings.training_api_url ||
    settings.training_api_base_url ||
    ""
  ).trim();
  const apiKey =
    cfg.apiKey || rootCfg.apiKey || settings.training_api_key || "";

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
  const attendeesInput = document.getElementById("training-booking-attendees");
  const notesInput = document.getElementById("training-booking-notes");
  const submitButton = document.getElementById("training-booking-submit");

  const user = helpCenter.user || {};
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

  function resolveUserType() {
    const segments = window.DigifySegments || window.DigifiedSegments || {};
    const isTenant =
      segments.isTenantUser === true || window.isTenantUser === true;
    return isTenant ? "tenant" : "staff";
  }

  function ensureConfig() {
    if (!baseUrl || !apiKey) {
      throw new Error(
        "Training booking isn't configured. Please contact support."
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
        if (params[key]) {
          url.searchParams.set(key, params[key]);
        }
      });
    }

    return url.toString();
  }

  function jsonpRequest(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName =
        "calApiJsonpCb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
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

  function createMetaRow(label, value) {
    const row = document.createElement("div");
    row.className = "tb-meta-row";

    const labelEl = document.createElement("span");
    labelEl.className = "tb-meta-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    valueEl.className = "tb-meta-value";
    valueEl.textContent = value || "n/a";

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
    topic.textContent = session.topic || "Training Room Session";

    const badges = document.createElement("div");
    badges.className = "tb-badges";

    const statusBadge = document.createElement("span");
    statusBadge.className = "tb-status-badge tb-status-badge--" + status;
    statusBadge.textContent = statusLabel(status);
    badges.appendChild(statusBadge);

    const meta = document.createElement("div");
    meta.className = "tb-meta";
    meta.appendChild(createMetaRow("Vendor", session.vendor || "TBA"));

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
  async function loadSessions() {
    clearAlert();

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
      const sessions =
        json && json.data && Array.isArray(json.data.sessions)
          ? json.data.sessions
          : [];
      cachedSessions = sessions
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

    if (slotIdInput) {
      slotIdInput.value = session.slot_id || "";
    }
    if (sessionSummary) {
      sessionSummary.textContent =
        formatDateLabel(session.date) +
        " | " +
        formatTimeRange(session.start_time, session.end_time) +
        " | " +
        (session.topic || "Training Room Session") +
        (session.vendor ? " | " + session.vendor : "");
    }

    if (requesterNameInput && user.name && !requesterNameInput.value) {
      requesterNameInput.value = user.name;
    }
    if (requesterEmailInput && user.email && !requesterEmailInput.value) {
      requesterEmailInput.value = user.email;
    }
    if (attendeesInput) {
      if (!attendeesInput.value) {
        attendeesInput.value = "1";
      }
      const seats = seatInfo(session);
      if (seats.capacity !== null) {
        attendeesInput.max = String(seats.capacity);
        if (Number(attendeesInput.value) > seats.capacity) {
          attendeesInput.value = String(seats.capacity);
        }
      } else {
        attendeesInput.removeAttribute("max");
      }
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("tb-modal-open");
  }

  function closeModal() {
    if (!modal) {
      return;
    }
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("tb-modal-open");
  }

  function buildBookingPayload() {
    const requesterName =
      (requesterNameInput && requesterNameInput.value.trim()) ||
      user.name ||
      "Zendesk User";
    const requesterEmail =
      (requesterEmailInput && requesterEmailInput.value.trim()) ||
      user.email ||
      "unknown@example.com";
    const resolvedUserType = resolveUserType();
    userType = resolvedUserType;
    const rawNotes = notesInput ? notesInput.value.trim() : "";
    const combinedNotes = rawNotes
      ? "Book Training Room - " + rawNotes
      : "Book Training Room";
    return {
      slot_id: slotIdInput ? slotIdInput.value : "",
      requester_email: requesterEmail,
      requester_name: requesterName,
      attendees: attendeesInput ? attendeesInput.value : "",
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
    const attendees = Number(payload.attendees);
    if (!attendees || attendees < 1) {
      return "Attendees must be at least 1.";
    }
    if (!payload.user_type) {
      return "User type is not available.";
    }
    return "";
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
        attendees: payload.attendees,
        user_type: payload.user_type,
        notes: payload.notes
      });
      const apiError = apiErrorMessage(json);
      if (apiError) {
        throw new Error(apiError);
      }

      const bookingData = json && json.data ? json.data : json;
      const bookingId = bookingData && bookingData.booking_id;
      const ticketUrl =
        bookingData && bookingData.zendesk && bookingData.zendesk.ticket_url;
      const ticketId =
        bookingData && bookingData.zendesk && bookingData.zendesk.ticket_id;
      const link = ticketUrl
        ? {
            href: ticketUrl,
            label: ticketId
              ? "Zendesk ticket #" + ticketId
              : "View Zendesk ticket"
          }
        : null;
      setAlert(
        "Booking confirmed. Reference " + (bookingId || "created") + ".",
        "success",
        { link: link }
      );
      closeModal();
      await loadSessions();
    } catch (error) {
      const message = friendlyErrorMessage(error, "Booking failed.");
      setAlert(message, "error", {
        action: { label: "Retry", onClick: function () { submitBooking(); } }
      });
    } finally {
      setBookingLoading(false);
    }
  }

  userType = resolveUserType();
  setDefaultDates();
  renderPlaceholder("Loading sessions...");

  if (requesterNameInput && user.name) {
    requesterNameInput.value = user.name;
  }
  if (requesterEmailInput && user.email) {
    requesterEmailInput.value = user.email;
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
