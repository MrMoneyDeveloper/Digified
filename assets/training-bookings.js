(function () {
  "use strict";

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
  const cfg = window.TRAINING_BOOKING_CFG || {};
  const baseUrl = (
    cfg.baseUrl ||
    settings.training_api_url ||
    settings.training_api_base_url ||
    ""
  ).trim();
  const apiKey = (cfg.apiKey || settings.training_api_key || "").trim();
  const mode = (cfg.mode || settings.training_api_mode || "jsonp").toLowerCase();
  const useJsonp = mode === "jsonp";

  // Core UI elements
  const alertEl = document.getElementById("training-booking-alert");
  const filtersForm = document.getElementById("training-booking-filters");
  const fromInput = document.getElementById("training-from");
  const toInput = document.getElementById("training-to");
  const deptFilter = document.getElementById("training-dept-filter");
  const availabilityFilter = document.getElementById("training-availability-filter");
  const sortSelect = document.getElementById("training-sort");
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
  const deptSelect = document.getElementById("training-booking-dept");
  const userTypeSelect = document.getElementById("training-booking-user-type");
  const notesInput = document.getElementById("training-booking-notes");
  const submitButton = document.getElementById("training-booking-submit");

  const user = helpCenter.user || {};
  const errorMessages = {
    FAIL_SLOT_FULL: "Sorry, this session is now full.",
    FAIL_ALREADY_BOOKED: "You have already booked this session.",
    FAIL_INVALID_SLOT: "This session is no longer available.",
    FAIL_CANCELLED: "This session has been cancelled.",
    UNAUTHORIZED: "API key not accepted. Update training_api_key."
  };

  const dateFormatter = new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Johannesburg"
  });

  let cachedSessions = [];

  // Status messaging
  function setAlert(message, type, link) {
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

    if (link && link.href && link.label) {
      const spacer = document.createTextNode(" ");
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      alertEl.appendChild(spacer);
      alertEl.appendChild(anchor);
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
    if (!fromInput || !toInput) {
      return;
    }

    const today = getSastDate();
    const future = new Date(today);
    future.setUTCDate(today.getUTCDate() + 30);

    if (!fromInput.value) {
      fromInput.value = toIsoDate(today);
    }
    if (!toInput.value) {
      toInput.value = toIsoDate(future);
    }
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
    topic.textContent = session.topic || "Training session";

    const badges = document.createElement("div");
    badges.className = "tb-badges";

    if (session.dept) {
      const deptBadge = document.createElement("span");
      deptBadge.className = "tb-dept-badge";
      deptBadge.textContent = session.dept;
      badges.appendChild(deptBadge);
    }

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
      renderPlaceholder("No sessions found for the selected range.");
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

  function applyFilters() {
    let sessions = cachedSessions.slice();

    const dept = deptFilter ? deptFilter.value.trim().toLowerCase() : "";
    const availability = availabilityFilter ? availabilityFilter.value : "all";

    if (dept) {
      sessions = sessions.filter(function (session) {
        return String(session.dept || "").toLowerCase() === dept;
      });
    }

    if (availability !== "all") {
      sessions = sessions.filter(function (session) {
        const seats = seatInfo(session);
        const status = sessionStatus(session, seats);
        return status === availability;
      });
    }

    const sortValue = sortSelect ? sortSelect.value : "date";
    sessions.sort(function (a, b) {
      if (sortValue === "topic") {
        return String(a.topic || "").localeCompare(String(b.topic || ""));
      }
      if (sortValue === "dept") {
        return String(a.dept || "").localeCompare(String(b.dept || ""));
      }

      const aKey = (a.date || "") + " " + (a.start_time || "");
      const bKey = (b.date || "") + " " + (b.start_time || "");
      return aKey.localeCompare(bKey);
    });

    return sessions;
  }

  function applyFiltersAndRender() {
    renderSessions(applyFilters());
  }

  // API helpers
  function buildUrl(action, params) {
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

    if (params) {
      Object.keys(params).forEach(function (key) {
        if (params[key]) {
          url.searchParams.set(key, params[key]);
        }
      });
    }

    if (apiKey) {
      url.searchParams.set("api_key", apiKey);
    }

    return url.toString();
  }

  function buildPostUrl() {
    if (!baseUrl) {
      return "";
    }
    try {
      const url = new URL(baseUrl);
      if (apiKey) {
        url.searchParams.set("api_key", apiKey);
      }
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function jsonpRequest(url) {
    return new Promise(function (resolve, reject) {
      const callbackName =
        "trainingJsonpCallback_" +
        Date.now() +
        "_" +
        Math.floor(Math.random() * 1000);
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
      }, 15000);

      const jsonpUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + callbackName;
      script.src = jsonpUrl;
      (document.head || document.body).appendChild(script);
    });
  }

  function safeJson(response) {
    if (!response) {
      return Promise.resolve(null);
    }
    return response
      .json()
      .catch(function () {
        return null;
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

  function isNetworkError(error) {
    return error && error.name === "TypeError";
  }

  // Sessions flow
  async function fetchSessions(from, to) {
    if (!baseUrl) {
      setAlert("Set Training API URL in theme settings.", "error");
      return null;
    }
    if (!apiKey) {
      setAlert("Set Training API key in theme settings.", "error");
      return null;
    }

    const url = buildUrl("sessions", { from: from, to: to });
    if (!url) {
      setAlert("Training API URL is invalid.", "error");
      return null;
    }

    let json = null;
    if (useJsonp) {
      json = await jsonpRequest(url);
    } else {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      json = await safeJson(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(json) || "Failed to load sessions.");
      }
    }

    const apiError = apiErrorMessage(json);
    if (apiError) {
      throw new Error(apiError);
    }

    if (json && json.data && Array.isArray(json.data.sessions)) {
      return json.data.sessions;
    }

    return [];
  }

  async function loadSessions() {
    clearAlert();

    if (!baseUrl) {
      setAlert("Set Training API URL in theme settings.", "error");
      return;
    }
    if (!apiKey) {
      setAlert("Set Training API key in theme settings.", "error");
      return;
    }

    const from = fromInput ? fromInput.value : "";
    const to = toInput ? toInput.value : "";
    if (!from || !to) {
      setAlert("Select a valid date range.", "error");
      return;
    }

    setLoading(true);
    try {
      const sessions = await fetchSessions(from, to);
      if (sessions === null) {
        return;
      }
      cachedSessions = sessions;
      applyFiltersAndRender();
    } catch (error) {
      if (isNetworkError(error)) {
        setAlert(
          "Unable to reach the training API. Check network or CORS settings.",
          "error"
        );
        return;
      }
      setAlert(
        error && error.message ? error.message : "Unable to load sessions.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  function openModal(session) {
    if (!modal) {
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
        (session.topic || "Training session") +
        (session.vendor ? " | " + session.vendor : "");
    }

    if (deptSelect && session.dept) {
      deptSelect.value = session.dept;
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
    return {
      action: "book",
      slot_id: slotIdInput ? slotIdInput.value : "",
      requester_email: requesterEmailInput ? requesterEmailInput.value.trim() : "",
      requester_name: requesterNameInput ? requesterNameInput.value.trim() : "",
      attendees: attendeesInput ? attendeesInput.value : "",
      notes: notesInput ? notesInput.value.trim() : "",
      dept: deptSelect ? deptSelect.value : "",
      user_type: userTypeSelect ? userTypeSelect.value : ""
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
      return "Select a user type.";
    }
    return "";
  }

  // Booking flow
  async function submitBooking(event) {
    if (event) {
      event.preventDefault();
    }

    clearAlert();
    if (!baseUrl) {
      setAlert("Set Training API URL in theme settings.", "error");
      return;
    }
    if (!apiKey) {
      setAlert("Set Training API key in theme settings.", "error");
      return;
    }

    const payload = buildBookingPayload();
    const validation = validatePayload(payload);
    if (validation) {
      setAlert(validation, "error");
      return;
    }

    const postUrl = buildPostUrl();
    if (!postUrl) {
      setAlert("Training API URL is invalid.", "error");
      return;
    }

    setBookingLoading(true);
    try {
      const response = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await safeJson(response);

      if (!response.ok) {
        throw new Error(apiErrorMessage(json) || "Booking failed.");
      }

      const apiError = apiErrorMessage(json);
      if (apiError) {
        throw new Error(apiError);
      }

      const bookingId = json && json.data && json.data.booking_id;
      const ticketUrl =
        json && json.data && json.data.zendesk && json.data.zendesk.ticket_url;
      const ticketId =
        json && json.data && json.data.zendesk && json.data.zendesk.ticket_id;
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
        link
      );
      closeModal();
      await loadSessions();
    } catch (error) {
      if (isNetworkError(error)) {
        setAlert(
          "Unable to reach the training API. Check network or CORS settings.",
          "error"
        );
        return;
      }
      setAlert(error && error.message ? error.message : "Booking failed.", "error");
    } finally {
      setBookingLoading(false);
    }
  }

  setDefaultDates();
  renderPlaceholder("Choose a date range and load sessions.");

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
      renderPlaceholder("Choose a date range and load sessions.");
    });
  }

  if (deptFilter) {
    deptFilter.addEventListener("change", applyFiltersAndRender);
  }
  if (availabilityFilter) {
    availabilityFilter.addEventListener("change", applyFiltersAndRender);
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", applyFiltersAndRender);
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
