(function () {
  "use strict";

  // Check if on the room booking page
  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/room_booking/.test(path)) {
    return;
  }

  // Get logger
  const logger = window.RoomBookingLogger || console;

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

  const user = (window.HelpCenter && window.HelpCenter.user) || {};

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
  const slotIdInput = document.getElementById("room-booking-slot-id");
  const requesterNameInput = document.getElementById("room-booking-requester-name");
  const requesterEmailInput = document.getElementById("room-booking-requester-email");
  const purposeInput = document.getElementById("room-booking-purpose");
  const attendeesInput = document.getElementById("room-booking-attendees");
  const notesInput = document.getElementById("room-booking-notes");
  const bookSubmit = document.getElementById("room-booking-submit");

  let cachedSlots = [];
  let activeSlot = null;

  // Business hours (8 AM to 6 PM)
  const BUSINESS_START = 8;
  const BUSINESS_END = 18;

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

  // Render visual timeline calendar
  function renderTimelineCalendar(roomSlots) {
    if (!timelineGrid || !dateDisplay) return;

    const selectedDate = dateInput.value;
    const dateObj = new Date(selectedDate + "T00:00:00");
    const dateStr = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    dateDisplay.textContent = `Room Availability - ${dateStr}`;

    // Generate time slots
    const timeSlots = generateTimeSlots();
    timelineGrid.innerHTML = "";

    // Create grid structure
    timeSlots.forEach((slot) => {
      // Time label column
      const timeLabel = document.createElement("div");
      timeLabel.className = "rb-time-label";
      timeLabel.textContent = slot.startTime;
      timelineGrid.appendChild(timeLabel);

      // Find booking for this hour
      const booking = roomSlots.find((b) => {
        const bookingHour = parseInt(b.start_time.split(":")[0], 10);
        return bookingHour === slot.hour;
      });

      // Create time slot cell
      const slotCell = document.createElement("div");
      slotCell.className = "rb-time-slot";

      if (booking && booking.booked) {
        slotCell.classList.add("rb-booked");
        slotCell.setAttribute("data-booker", `Booked by: ${booking.booker_name || "Unknown"}`);
        slotCell.innerHTML = `<span>${slot.startTime} - ${slot.endTime}</span>`;
      } else {
        slotCell.classList.add("rb-available");
        slotCell.innerHTML = `<span>${slot.startTime} - ${slot.endTime}</span>`;
        slotCell.setAttribute("data-slot-id", booking ? booking.slot_id : `slot_${slot.hour}`);
        slotCell.setAttribute("data-start-time", slot.startTime);
        slotCell.setAttribute("data-end-time", slot.endTime);

        slotCell.addEventListener("click", () => {
          openBookingModal({
            slot_id: booking ? booking.slot_id : `slot_${slot.hour}`,
            date: selectedDate,
            start_time: slot.startTime,
            end_time: slot.endTime
          });
        });
      }

      timelineGrid.appendChild(slotCell);
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

    activeSlot = slot;

    logger.info("Booking modal opened", {
      slot_id: slot.slot_id,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time
    });

    if (slotIdInput) slotIdInput.value = slot.slot_id || "";
    if (sessionSummary) {
      sessionSummary.innerHTML = `
        <strong>Date:</strong> ${slot.date}<br>
        <strong>Time:</strong> ${slot.start_time} - ${slot.end_time}
      `;
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  // Close booking modal
  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    if (modalForm) modalForm.reset();
  }

  // Submit booking
  async function submitBooking(event) {
    if (event) event.preventDefault();

    const payload = {
      slot_id: slotIdInput ? slotIdInput.value : "",
      date: activeSlot ? activeSlot.date : "",
      start_time: activeSlot ? activeSlot.start_time : "",
      requester_name: requesterNameInput ? requesterNameInput.value.trim() : "",
      requester_email: requesterEmailInput ? requesterEmailInput.value.trim() : "",
      purpose: purposeInput ? purposeInput.value.trim() : "",
      attendees: attendeesInput ? attendeesInput.value : "",
      notes: notesInput ? notesInput.value.trim() : ""
    };

    logger.info("Booking submission started", {
      slot_id: payload.slot_id,
      date: payload.date,
      requesterName: payload.requester_name
    });

    if (!payload.requester_name || !payload.requester_email) {
      logger.warn("Booking validation failed - missing name or email", {
        hasName: !!payload.requester_name,
        hasEmail: !!payload.requester_email
      });
      setAlert("Name and email are required.", "error");
      return;
    }

    if (!payload.purpose) {
      logger.warn("Booking validation failed - missing purpose", {});
      setAlert("Please specify the meeting purpose.", "error");
      return;
    }

    if (bookSubmit) {
      bookSubmit.disabled = true;
      bookSubmit.textContent = "Booking...";
    }

    try {
      logger.info("Sending booking request to API", {
        action: "book_room",
        slotId: payload.slot_id,
        date: payload.date
      });

      const json = await jsonpRequest("book_room", payload);

      if (json && json.success) {
        logger.info("Booking successful", {
          response: json,
          bookingId: json.data && json.data.booking_id,
          ticketId: json.data && json.data.ticket_id
        });

        setAlert("Room booked successfully!", "success");

        // Change button to red "BOOKED" state
        if (bookSubmit) {
          bookSubmit.classList.add("rb-booked-state");
          bookSubmit.textContent = "BOOKED";
        }

        setTimeout(() => {
          closeModal();
          loadAndRenderCalendar(); // Refresh calendar
        }, 2000);
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

      setAlert(error.message || "Booking failed. Please try again.", "error");

      if (bookSubmit) {
        bookSubmit.disabled = false;
        bookSubmit.textContent = "Book Now";
      }
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
    filtersForm.addEventListener("submit", (e) => {
      e.preventDefault();
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
  if (modalForm) modalForm.addEventListener("submit", submitBooking);

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
