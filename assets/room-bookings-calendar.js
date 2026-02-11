(function () {
  "use strict";

  // Check if on the room booking page
  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/room_booking/.test(path)) {
    return;
  }

  // Get logger
  const logger = window.RoomBookingLogger || console;
  const buildTag = document.querySelector("[data-room-booking-build]");

  const root = document.getElementById("room-booking-root");
  // Signed-out fallback view has no booking root; avoid initializing the booking app.
  if (!root) {
    logger.info("Room booking app init skipped", {
      reason: "room-booking-root not found",
      buildTag: buildTag ? buildTag.getAttribute("data-room-booking-build") : "missing"
    });
    return;
  }

  logger.info("Room booking template detected", {
    buildTag: buildTag ? buildTag.getAttribute("data-room-booking-build") : "missing",
    rootVersion: root.getAttribute("data-room-booking-version") || "missing"
  });

  function getCurrentUser() {
    if (typeof HelpCenter !== "undefined" && HelpCenter.user) {
      return {
        name: HelpCenter.user.name || "",
        email: HelpCenter.user.email || ""
      };
    }

    if (window.TRAINING_BOOKING_USER) {
      return {
        name: window.TRAINING_BOOKING_USER.name || "",
        email: window.TRAINING_BOOKING_USER.email || ""
      };
    }

    if (window.currentUserName && window.currentUserEmail) {
      return {
        name: window.currentUserName || "",
        email: window.currentUserEmail || ""
      };
    }

    console.warn("[RoomBooking] Could not find user data");
    return {
      name: "Unknown User",
      email: "unknown@example.com"
    };
  }

  // HARDCODED FALLBACK CONFIGURATION
  // This is your Google Apps Script URL - update if it changes
  const HARDCODED_API_URL = "https://script.google.com/macros/s/AKfycbxKZUHO8KiN6-oawtgTnXJy9yf2OPUT1hpnRgcrnygAB8SzMv3J5EylrhC4_Dgv0_dX/exec";
  const HARDCODED_API_KEY = "c8032a6a14e04710a701aadd27f8e5d5";

  // Configuration resolution order:
  // 1. Theme settings from Zendesk admin
  // 2. Window config from HTML template
  // 3. Hardcoded fallback
  const settings = (window.HelpCenter && window.HelpCenter.themeSettings) || {};
  const cfg = window.ROOM_BOOKING_CFG || {};

  const baseUrl = (
    (settings.room_booking_api_url && settings.room_booking_api_url.trim()) ||
    (cfg.baseUrl && cfg.baseUrl.trim()) ||
    HARDCODED_API_URL
  ).trim();

  const apiKey = (
    (settings.room_booking_api_key && settings.room_booking_api_key.trim()) ||
    (cfg.apiKey && cfg.apiKey.trim()) ||
    HARDCODED_API_KEY
  ).trim();

  const user = getCurrentUser();

  // Log configuration resolution
  logger.info("Room Booking Configuration Resolved", {
    baseUrl: baseUrl,
    apiKeyPresent: apiKey.length > 0,
    configSource: {
      cfgBaseUrl: !!cfg.baseUrl,
      settingsBaseUrl: !!settings.room_booking_api_url,
      usingFallback: baseUrl === HARDCODED_API_URL
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });

  // DOM Elements
  const alertEl = document.getElementById("room-booking-alert");
  const filtersForm = document.getElementById("room-booking-filters");
  const dateInput = document.getElementById("room-date");
  const loadButton = document.getElementById("room-load");
  const resetButton = document.getElementById("room-reset");
  const loadingEl = document.getElementById("room-booking-loading");
  const timelineCalendar = document.getElementById("room-timeline-calendar");
  const timelineGrid = document.getElementById("room-timeline-grid");
  const dateDisplay = document.getElementById("rb-selected-date-display");

  const modal = document.getElementById("room-booking-modal");
  const modalForm = document.getElementById("room-booking-form");
  const modalClose = document.getElementById("room-booking-modal-close");
  const modalCancel = document.getElementById("room-booking-modal-cancel");
  const sessionSummary = document.getElementById("room-booking-session-summary");
  const submitStateEl = document.getElementById("room-booking-submit-state");
  const slotIdInput = document.getElementById("room-booking-slot-id");
  const requesterNameInput = document.getElementById("room-booking-requester-name");
  const requesterEmailInput = document.getElementById("room-booking-requester-email");
  const notesInput = document.getElementById("room-booking-notes");
  const hybridToggle = document.getElementById("room-booking-hybrid");
  const attendeesField = document.getElementById("room-booking-attendees-field");
  const attendeesWrap = document.getElementById("room-booking-attendees");
  const addAttendeeButton = document.getElementById("room-booking-add-attendee");
  const bookSubmit = document.getElementById("room-booking-submit");

  let cachedSlots = [];
  let activeSlot = null;
  let lastFocusedElement = null;
  let bookingInProgress = false;

  // Business hours (8 AM to 8 PM)
  const BUSINESS_START = 8;
  const BUSINESS_END = 20;

  // Alert functions
  function setAlert(message, type) {
    if (!alertEl) return;
    alertEl.textContent = message;
    alertEl.className = "rb-alert";
    if (type) alertEl.classList.add("rb-alert--" + type);
    alertEl.hidden = false;
  }

  function clearAlert() {
    if (!alertEl) return;
    alertEl.textContent = "";
    alertEl.hidden = true;
    alertEl.className = "rb-alert";
  }

  function setSubmitState(type, message) {
    if (!submitStateEl) return;
    if (!message) {
      submitStateEl.textContent = "";
      submitStateEl.className = "rb-submit-state";
      submitStateEl.hidden = true;
      return;
    }
    submitStateEl.textContent = message;
    submitStateEl.className = "rb-submit-state";
    if (type) submitStateEl.classList.add("rb-submit-state--" + type);
    submitStateEl.hidden = false;
  }

  function setBookingUiLocked(isLocked) {
    bookingInProgress = !!isLocked;
    if (bookSubmit) {
      bookSubmit.disabled = !!isLocked;
      if (isLocked) {
        bookSubmit.classList.add("rb-submit-pending");
      } else {
        bookSubmit.classList.remove("rb-submit-pending");
      }
    }
    if (modalCancel) modalCancel.disabled = !!isLocked;
    if (modalClose) modalClose.disabled = !!isLocked;
  }

  function isValidatableField(field) {
    if (!field || field.disabled) return false;
    if ((field.type || "").toLowerCase() === "hidden") return false;
    if (field.closest("[hidden]")) return false;
    return true;
  }

  function getFormControls(form) {
    if (!form) return [];
    return Array.from(form.querySelectorAll("input, select, textarea")).filter(isValidatableField);
  }

  function getFieldKey(field) {
    return field.id || field.name || "";
  }

  function getFeedbackNode(field) {
    const key = getFieldKey(field);
    if (!key || !field.parentElement) return null;
    return Array.from(field.parentElement.querySelectorAll(".rb-invalid-feedback")).find((node) => {
      return node.getAttribute("data-rb-feedback-for") === key;
    }) || null;
  }

  function ensureFeedbackNode(field) {
    const key = getFieldKey(field);
    if (!key) return null;
    const existing = getFeedbackNode(field);
    if (existing) return existing;

    const node = document.createElement("div");
    node.className = "invalid-feedback rb-invalid-feedback";
    node.setAttribute("data-rb-feedback-for", key);
    node.hidden = true;
    field.insertAdjacentElement("afterend", node);
    return node;
  }

  function clearFieldInvalid(field) {
    if (!field) return;
    field.classList.remove("is-invalid");
    field.removeAttribute("aria-invalid");
    const wrapper = field.closest(".rb-field");
    if (wrapper) wrapper.classList.remove("rb-field--invalid");

    const feedback = getFeedbackNode(field);
    if (feedback) {
      feedback.hidden = true;
      feedback.textContent = "";
    }
  }

  function markFieldInvalid(field, message) {
    if (!field) return;
    field.classList.add("is-invalid");
    field.setAttribute("aria-invalid", "true");
    const wrapper = field.closest(".rb-field");
    if (wrapper) wrapper.classList.add("rb-field--invalid");

    const feedback = ensureFeedbackNode(field);
    if (feedback) {
      feedback.textContent = message || field.validationMessage || "This field is required.";
      feedback.hidden = false;
    }
  }

  function bindFieldValidation(field) {
    if (!field || field.dataset.rbValidationBound === "1") return;
    field.dataset.rbValidationBound = "1";

    const onFieldEdit = () => {
      if (!isValidatableField(field)) {
        clearFieldInvalid(field);
        return;
      }
      if (typeof field.checkValidity === "function" && field.checkValidity()) {
        clearFieldInvalid(field);
      }
    };

    field.addEventListener("input", onFieldEdit);
    field.addEventListener("change", onFieldEdit);
  }

  function clearFormValidation(form) {
    getFormControls(form).forEach((field) => {
      clearFieldInvalid(field);
    });
  }

  function validateFormFields(form) {
    const controls = getFormControls(form);
    let firstInvalid = null;

    controls.forEach((field) => {
      if (typeof field.checkValidity !== "function") return;
      if (!field.checkValidity()) {
        markFieldInvalid(field, field.validationMessage);
        if (!firstInvalid) firstInvalid = field;
      } else {
        clearFieldInvalid(field);
      }
    });

    return firstInvalid;
  }

  function clearAttendeeInputs() {
    if (!attendeesWrap) return;
    attendeesWrap.innerHTML = "";
  }

  function addAttendeeInput(value) {
    if (!attendeesWrap) return;
    const count = attendeesWrap.querySelectorAll("input").length + 1;
    const input = document.createElement("input");
    input.type = "email";
    input.name = "attendee_emails[]";
    input.className = "form-control";
    input.placeholder = "participant@example.com";
    input.autocomplete = "email";
    input.inputMode = "email";
    if (count === 1) {
      input.id = "room-booking-attendee-1";
      if (hybridToggle && hybridToggle.checked) {
        input.required = true;
      }
    }
    if (value) input.value = value;
    attendeesWrap.appendChild(input);
    bindFieldValidation(input);
  }

  function setAttendeeFieldsVisible(isVisible) {
    if (!attendeesField) return;
    attendeesField.hidden = !isVisible;
    if (!isVisible) {
      clearAttendeeInputs();
      clearFormValidation(modalForm);
      return;
    }
    if (attendeesWrap && attendeesWrap.querySelectorAll("input").length === 0) {
      addAttendeeInput("");
    }
  }

  function getAttendeeEmails() {
    if (!attendeesWrap) return [];
    const seen = {};
    const out = [];
    Array.from(attendeesWrap.querySelectorAll("input")).forEach((input) => {
      const email = String(input.value || "").trim().toLowerCase();
      if (!email || seen[email]) return;
      seen[email] = true;
      out.push(email);
    });
    return out;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function timeToLabel(timeHHMM) {
    const raw = String(timeHHMM || "").trim();
    if (!/^\d{2}:\d{2}$/.test(raw)) return raw || "--";
    const parts = raw.split(":");
    const hh = Number(parts[0]);
    const mm = parts[1];
    const period = hh >= 12 ? "PM" : "AM";
    const hr12 = ((hh + 11) % 12) + 1;
    return `${hr12}:${mm} ${period}`;
  }

  function buildSlotIdForDateTime(dateStr, startTime) {
    const safeDate = String(dateStr || "").trim();
    const safeTime = String(startTime || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate) || !/^\d{2}:\d{2}$/.test(safeTime)) {
      return "";
    }
    return `SLOT_${safeDate}_${safeTime.replace(":", "")}`.toUpperCase();
  }

  function upsertCachedBookedSlot(slotId, requesterName) {
    const normalizedSlotId = String(slotId || "").trim().toUpperCase();
    if (!normalizedSlotId) return;

    let found = false;
    cachedSlots = (cachedSlots || []).map((slot) => {
      const currentId = String(slot.slot_id || "").trim().toUpperCase();
      if (currentId !== normalizedSlotId) return slot;
      found = true;
      return Object.assign({}, slot, {
        booked: true,
        booker_name: requesterName || slot.booker_name || "Unknown"
      });
    });

    if (found) return;

    const parsed = normalizedSlotId.match(/^SLOT_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$/);
    if (!parsed) return;
    const date = parsed[1];
    const start = `${parsed[2]}:${parsed[3]}`;
    const endHour = String((Number(parsed[2]) + 1) % 24).padStart(2, "0");
    const end = `${endHour}:${parsed[3]}`;
    cachedSlots.push({
      slot_id: normalizedSlotId,
      date: date,
      start_time: start,
      end_time: end,
      booked: true,
      booker_name: requesterName || "Unknown"
    });
  }

  // Set default date to today
  function setDefaultDate() {
    if (!dateInput) return;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  // Loading state
  function setLoading(isLoading) {
    if (loadButton) loadButton.disabled = isLoading;
    if (loadingEl) loadingEl.hidden = !isLoading;
    if (timelineCalendar) timelineCalendar.hidden = isLoading;
  }

  // Build API URL
  function buildUrl(action, params) {
    if (!baseUrl) return "";
    try {
      const url = new URL(baseUrl);
      if (action) url.searchParams.set("action", action);
      if (params) {
        Object.keys(params).forEach((key) => {
          if (params[key]) url.searchParams.set(key, params[key]);
        });
      }
      if (apiKey) url.searchParams.set("api_key", apiKey);
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  // JSONP request with logging
  function jsonpRequest(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName = "roomJsonpCb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const url = buildUrl(action, params);
      const requestId = callbackName;

      if (!url) {
        logger.error("Failed to build API URL", {
          action: action,
          params: params,
          baseUrl: baseUrl
        });
        reject(new Error("Room booking API URL is invalid."));
        return;
      }

      let requestUrl = url;
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.set("callback", callbackName);
        requestUrl = urlObj.toString();
      } catch (error) {
        logger.error("Failed to append JSONP callback", {
          action: action,
          baseUrl: url,
          error: error && error.message ? error.message : error
        });
        reject(new Error("Room booking API URL is invalid."));
        return;
      }

      logger.info("JSONP request initiated", {
        requestId: requestId,
        action: action,
        url: requestUrl,
        params: params,
        callback: callbackName
      });

      const script = document.createElement("script");
      let timeoutId = null;
      const startTime = performance.now();

      function cleanup() {
        if (timeoutId) clearTimeout(timeoutId);
        if (window[callbackName]) delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = (data) => {
        const duration = (performance.now() - startTime).toFixed(2);
        cleanup();

        logger.info("JSONP response received", {
          requestId: requestId,
          action: action,
          duration: `${duration}ms`,
          success: data && data.success,
          dataKeys: data ? Object.keys(data) : null
        });

        resolve(data);
      };

      script.onerror = () => {
        const duration = (performance.now() - startTime).toFixed(2);
        cleanup();

        logger.error("JSONP script load error", {
          requestId: requestId,
          action: action,
          duration: `${duration}ms`,
          scriptUrl: requestUrl
        });

        reject(new Error("JSONP request failed."));
      };

      timeoutId = setTimeout(() => {
        const duration = (performance.now() - startTime).toFixed(2);
        cleanup();

        logger.error("JSONP request timeout", {
          requestId: requestId,
          action: action,
          duration: `${duration}ms`,
          timeout: "15000ms"
        });

        reject(new Error("JSONP request timed out."));
      }, 15000);

      script.src = requestUrl;
      (document.head || document.body).appendChild(script);
    });
  }

  // Fetch room slots for selected date
  async function fetchRoomSlots() {
    // Validate configuration
    if (!baseUrl) {
      const errorMsg = "Room booking API URL is not configured. Please check theme settings or contact support.";
      logger.error("Configuration validation failed", {
        baseUrl: baseUrl,
        apiKey: apiKey ? "present" : "missing"
      });
      setAlert(errorMsg, "error");
      return null;
    }

    const date = dateInput ? dateInput.value : "";
    if (!date) {
      logger.warn("No date selected", {});
      setAlert("Please select a date.", "error");
      return null;
    }

    logger.info("Fetching room slots", { date: date });

    try {
      logger.info("Sending JSONP request", {
        action: "sessions",
        from: date,
        to: date,
        apiUrl: baseUrl
      });

      const json = await jsonpRequest("sessions", { from: date, to: date });

      if (json && json.success && Array.isArray(json.data.sessions)) {
        const sessions = json.data.sessions;
        const slots = sessions.map((session) => {
          const status = String(session.status || "").toLowerCase();
          const capacity = Number(session.capacity);
          const bookedCount = Number(session.booked_count);
          let booked = false;

          if (session.available === false) {
            booked = true;
          }
          if (status === "full" || status === "cancelled") {
            booked = true;
          }
          if (
            !Number.isNaN(capacity) &&
            !Number.isNaN(bookedCount) &&
            bookedCount >= capacity
          ) {
            booked = true;
          }

          return {
            slot_id: session.slot_id || "",
            date: session.date || date,
            start_time: session.start_time || "",
            end_time: session.end_time || "",
            booked: booked,
            booker_name: session.reserved_by || session.vendor || session.booker_name || null
          };
        });

        logger.info("Room slots loaded successfully", {
          slotCount: slots.length,
          slots: slots.map((slot) => ({
            date: slot.date,
            start_time: slot.start_time,
            booked: slot.booked,
            booker_name: slot.booker_name
          }))
        });
        return slots;
      }

      const errorMsg = json.message || "Failed to load room slots.";
      logger.error("API returned unsuccessful response", {
        response: json,
        success: json && json.success,
        hasSessions: json && json.data && Array.isArray(json.data.sessions)
      });
      throw new Error(errorMsg);
    } catch (error) {
      logger.error("Room API request failed", {
        error: error.message,
        errorStack: error.stack,
        date: date
      });
      throw error;
    }
  }

  // Generate hourly time slots
  function generateTimeSlots() {
    const slots = [];
    for (let hour = BUSINESS_START; hour < BUSINESS_END; hour++) {
      const startTime = `${String(hour).padStart(2, "0")}:00`;
      const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
      slots.push({ hour, startTime, endTime });
    }
    return slots;
  }

  // Render slot cards
  function renderTimelineCalendar(roomSlots) {
    if (!timelineGrid || !dateDisplay) return;

    const selectedDate = dateInput && dateInput.value ? dateInput.value : "";
    const dateObj = selectedDate ? new Date(selectedDate + "T00:00:00") : new Date();
    const dateStr = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    dateDisplay.textContent = `Room Availability - ${dateStr}`;

    const timeSlots = generateTimeSlots();
    timelineGrid.innerHTML = "";

    timeSlots.forEach((slot, index) => {
      const booking = (roomSlots || []).find((b) => {
        const bookingHour = parseInt(String(b.start_time || "00:00").split(":")[0], 10);
        return bookingHour === slot.hour;
      });

      const slotId = booking && booking.slot_id
        ? String(booking.slot_id).trim()
        : buildSlotIdForDateTime(selectedDate, slot.startTime);
      const isBooked = !!(booking && booking.booked);
      const bookerName = booking && booking.booker_name ? String(booking.booker_name).trim() : "";
      const bookedByLabel = bookerName ? `Booked by: ${bookerName}` : "Booked by: Unknown";

      const card = document.createElement("article");
      card.className = "rb-slot-card";
      card.style.setProperty("--rb-slot-index", String(index));
      card.setAttribute("data-slot-id", slotId);
      card.setAttribute("data-start-time", slot.startTime);
      card.setAttribute("data-end-time", slot.endTime);

      const status = document.createElement("span");
      status.className = "rb-slot-card__status";
      status.textContent = isBooked ? "Booked" : "Available";
      card.appendChild(status);

      const time = document.createElement("h4");
      time.className = "rb-slot-card__time";
      time.textContent = `${timeToLabel(slot.startTime)} - ${timeToLabel(slot.endTime)}`;
      card.appendChild(time);

      const meta = document.createElement("p");
      meta.className = "rb-slot-card__meta";
      meta.textContent = isBooked
        ? "This room slot is currently unavailable."
        : "Tap to book this room slot.";
      card.appendChild(meta);

      const booker = document.createElement("p");
      booker.className = "rb-slot-card__booker";
      if (isBooked) {
        booker.textContent = bookedByLabel;
      } else {
        booker.textContent = "Open";
      }
      card.appendChild(booker);

      if (isBooked) {
        card.classList.add("rb-slot-card--booked");
        card.setAttribute("data-booker", bookedByLabel);
        card.setAttribute("aria-label", `${time.textContent}. ${bookedByLabel}`);
      } else {
        card.classList.add("rb-slot-card--available");
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", `Book slot ${time.textContent}`);
        card.addEventListener("click", () => {
          openBookingModal({
            slot_id: slotId,
            date: selectedDate,
            start_time: slot.startTime,
            end_time: slot.endTime
          });
        });
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openBookingModal({
              slot_id: slotId,
              date: selectedDate,
              start_time: slot.startTime,
              end_time: slot.endTime
            });
          }
        });
      }

      timelineGrid.appendChild(card);
    });

    timelineCalendar.hidden = false;
  }

  // Load and render calendar
  async function loadAndRenderCalendar() {
    clearAlert();
    setLoading(true);

    try {
      const slots = await fetchRoomSlots();
      if (slots === null) return;

      cachedSlots = slots;
      renderTimelineCalendar(cachedSlots);
    } catch (error) {
      setAlert(error.message || "Unable to load room availability.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Open booking modal
  function openBookingModal(slot) {
    if (!modal || !modalForm) return;

    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeSlot = slot;
    setBookingUiLocked(false);
    setSubmitState("", "");
    if (bookSubmit) bookSubmit.textContent = "Confirm Booking";

    const currentUser = getCurrentUser();
    console.log("[RoomBooking] Opening modal, user:", currentUser);

    logger.info("Booking modal opened", {
      slot_id: slot.slot_id,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time
    });

    if (slotIdInput) slotIdInput.value = slot.slot_id || "";
    if (requesterNameInput) {
      requesterNameInput.value = currentUser.name;
      requesterNameInput.removeAttribute("disabled");
      requesterNameInput.setAttribute("readonly", true);
      requesterNameInput.style.backgroundColor = "#f5f5f5";
      requesterNameInput.style.cursor = "not-allowed";
    }
    if (requesterEmailInput) {
      requesterEmailInput.value = currentUser.email;
      requesterEmailInput.removeAttribute("disabled");
      requesterEmailInput.setAttribute("readonly", true);
      requesterEmailInput.style.backgroundColor = "#f5f5f5";
      requesterEmailInput.style.cursor = "not-allowed";
    }
    if (notesInput) {
      notesInput.value = "";
    }
    if (hybridToggle) {
      hybridToggle.checked = false;
    }
    setAttendeeFieldsVisible(false);
    clearFormValidation(modalForm);
    if (sessionSummary) {
      sessionSummary.innerHTML = `
        <strong>Date:</strong> ${slot.date}<br>
        <strong>Time:</strong> ${timeToLabel(slot.start_time)} - ${timeToLabel(slot.end_time)}
      `;
    }

    modal.hidden = false;
    modal.removeAttribute("inert");
    modal.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => {
      if (modalClose) {
        modalClose.focus();
      }
    });
  }

  // Close booking modal
  function closeModal() {
    if (!modal) return;
    if (bookingInProgress) return;
    if (modal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    modal.hidden = true;
    modal.setAttribute("inert", "");
    modal.setAttribute("aria-hidden", "true");
    if (notesInput) notesInput.value = "";
    if (hybridToggle) hybridToggle.checked = false;
    setAttendeeFieldsVisible(false);
    setBookingUiLocked(false);
    setSubmitState("", "");
    if (bookSubmit) {
      bookSubmit.textContent = "Confirm Booking";
      bookSubmit.classList.remove("rb-booked-state");
    }
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  // Submit booking
  async function submitBooking(event) {
    if (event) event.preventDefault();
    clearAlert();
    clearFormValidation(modalForm);

    const nativeInvalidField = validateFormFields(modalForm);
    if (nativeInvalidField) {
      const message = "Please complete the highlighted required fields.";
      setAlert(message, "error");
      setSubmitState("error", message);
      nativeInvalidField.focus();
      if (typeof nativeInvalidField.reportValidity === "function") {
        nativeInvalidField.reportValidity();
      }
      return;
    }

    const currentUser = getCurrentUser();
    const hasRemoteParticipants = !!(hybridToggle && hybridToggle.checked);
    const attendeeEmails = hasRemoteParticipants ? getAttendeeEmails() : [];
    const meetingType = hasRemoteParticipants
      ? "in_person_plus_online"
      : "in_person_only";

    const payload = {
      slot_id: slotIdInput ? slotIdInput.value : "",
      date: activeSlot ? activeSlot.date : "",
      start_time: activeSlot ? activeSlot.start_time : "",
      requester_name: currentUser.name || "",
      requester_email: currentUser.email || "",
      notes: notesInput ? notesInput.value.trim() : "",
      meeting_type: meetingType,
      attendee_emails: attendeeEmails.join(",")
    };

    logger.info("Booking submission started", {
      slot_id: payload.slot_id,
      date: payload.date,
      requesterName: payload.requester_name,
      meeting_type: payload.meeting_type,
      attendee_count: attendeeEmails.length
    });

    if (!payload.requester_name || !payload.requester_email) {
      logger.warn("Booking validation failed - missing name or email", {
        hasName: !!payload.requester_name,
        hasEmail: !!payload.requester_email
      });
      const message = "Name and email are required.";
      if (!payload.requester_name && requesterNameInput) {
        markFieldInvalid(requesterNameInput, "Requester name is required.");
      }
      if (!payload.requester_email && requesterEmailInput) {
        markFieldInvalid(requesterEmailInput, "Requester email is required.");
      }
      setAlert(message, "error");
      setSubmitState("error", message);
      return;
    }

    if (hasRemoteParticipants && attendeeEmails.length === 0) {
      let attendeeInput = attendeesWrap ? attendeesWrap.querySelector("input") : null;
      if (!attendeeInput) {
        addAttendeeInput("");
        attendeeInput = attendeesWrap ? attendeesWrap.querySelector("input") : null;
      }
      if (attendeeInput) {
        attendeeInput.required = true;
        markFieldInvalid(attendeeInput, "Add at least one remote participant email.");
        attendeeInput.focus();
      }
      const message = "Add at least one remote participant email.";
      setAlert(message, "error");
      setSubmitState("error", message);
      return;
    }
    if (hasRemoteParticipants) {
      const invalidInput = attendeesWrap
        ? Array.from(attendeesWrap.querySelectorAll("input")).find((input) => {
            const value = String(input.value || "").trim();
            return value && !isValidEmail(value);
          })
        : null;
      if (invalidInput) {
        const message = "One or more remote participant emails are invalid.";
        markFieldInvalid(invalidInput, "Please enter a valid email address.");
        invalidInput.focus();
        setAlert(message, "error");
        setSubmitState("error", message);
        return;
      }
    }

    setBookingUiLocked(true);
    setSubmitState("pending", "Confirming your booking...");
    if (bookSubmit) bookSubmit.textContent = "Confirming...";

    try {
      logger.info("Sending booking request to API", {
        action: "book",
        slotId: payload.slot_id,
        date: payload.date
      });

      const json = await jsonpRequest("book", payload);

      if (json && json.success) {
        const meet =
          json &&
          json.data &&
          json.data.meet &&
          typeof json.data.meet === "object"
            ? json.data.meet
            : {};

        logger.info("Booking successful", {
          response: json,
          bookingId: json.data && json.data.booking_id,
          ticketId: json.data && json.data.ticket_id,
          meet_status: meet.status || "",
          meet_link: meet.meet_link || ""
        });

        let successMessage = "Room booked successfully!";
        if (payload.meeting_type === "in_person_plus_online") {
          if (meet && meet.meet_link) {
            successMessage = "Room booked and Google Meet link created. Invitations are sent to requester and remote participants.";
          } else if (meet && meet.status === "failed") {
            successMessage = "Room booked, but Google Meet link generation failed. The Zendesk ticket includes the failure details.";
          } else {
            successMessage = "Room booked. Google Meet link creation is still processing.";
          }
        }
        setAlert(successMessage, meet && meet.status === "failed" ? "error" : "success");
        setSubmitState(
          meet && meet.status === "failed" ? "error" : "success",
          successMessage
        );

        // Change button to red "BOOKED" state
        if (bookSubmit) {
          bookSubmit.classList.add("rb-booked-state");
          bookSubmit.textContent = "BOOKED";
        }

        upsertCachedBookedSlot(payload.slot_id, payload.requester_name || "Unknown");
        renderTimelineCalendar(cachedSlots);

        setTimeout(() => {
          setBookingUiLocked(false);
          closeModal();
        }, 1800);
      } else {
        const errorMsg = json.message || "Booking failed.";
        logger.error("Booking request returned false", {
          response: json,
          message: errorMsg
        });
        throw new Error(errorMsg);
      }
    } catch (error) {
      logger.error("Booking submission failed", {
        error: error.message,
        errorStack: error.stack,
        payload: payload
      });

      const failMsg = error.message || "Booking failed. Please try again.";
      setAlert(failMsg, "error");
      setSubmitState("error", failMsg);
      setBookingUiLocked(false);
      if (bookSubmit) bookSubmit.textContent = "Confirm Booking";
    }
  }

  // Initialize
  logger.info("Initializing room booking system", {
    hasUser: !!user,
    userName: user.name,
    userEmail: user.email
  });

  if (requesterNameInput && user.name) requesterNameInput.value = user.name;
  if (requesterEmailInput && user.email) requesterEmailInput.value = user.email;

  if (filtersForm) {
    getFormControls(filtersForm).forEach(bindFieldValidation);
    filtersForm.addEventListener("submit", (e) => {
      e.preventDefault();
      clearAlert();
      clearFormValidation(filtersForm);
      const invalidField = validateFormFields(filtersForm);
      if (invalidField) {
        const message = "Please select a date before loading availability.";
        setAlert(message, "error");
        invalidField.focus();
        if (typeof invalidField.reportValidity === "function") {
          invalidField.reportValidity();
        }
        return;
      }
      logger.info("Date filter submitted", { date: dateInput.value });
      loadAndRenderCalendar();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      logger.info("Reset button clicked", {});
      if (filtersForm) filtersForm.reset();
      setDefaultDate();
      clearAlert();
      if (timelineCalendar) timelineCalendar.hidden = true;
    });
  }

  if (modalClose) {
    modalClose.addEventListener("click", () => {
      logger.info("Modal closed via close button", {});
      closeModal();
    });
  }
  if (modalCancel) {
    modalCancel.addEventListener("click", () => {
      logger.info("Modal closed via cancel button", {});
      closeModal();
    });
  }
  if (hybridToggle) {
    hybridToggle.addEventListener("change", () => {
      setAttendeeFieldsVisible(hybridToggle.checked);
    });
  }
  if (addAttendeeButton) {
    addAttendeeButton.addEventListener("click", () => {
      if (!hybridToggle || !hybridToggle.checked) return;
      addAttendeeInput("");
    });
  }
  if (modalForm) {
    getFormControls(modalForm).forEach(bindFieldValidation);
    modalForm.addEventListener("submit", submitBooking);
  }
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeModal();
    }
  });

  // Load on page load
  logger.info("Room booking page load complete", {
    configUrl: baseUrl,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString()
  });

  setDefaultDate();
  loadAndRenderCalendar();

  // Expose logger for debugging in browser console
  window.RoomBookingDebug = {
    logs: function() { return logger.logs || []; },
    export: function() {
      return logger.export ? logger.export() : JSON.stringify(logger.logs || [], null, 2);
    },
    config: function() { return { baseUrl: baseUrl, apiKeyPresent: apiKey.length > 0 }; },
    user: function() { return user; }
  };
  logger.info("Debug interface available at: window.RoomBookingDebug", {});
})();
