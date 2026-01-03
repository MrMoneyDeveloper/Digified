(function () {
  "use strict";

  // Check if on the room booking page
  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/room_booking/.test(path)) {
    return;
  }

  // Configuration
  const settings = (window.HelpCenter && window.HelpCenter.themeSettings) || {};
  const cfg = window.ROOM_BOOKING_CFG || {};
  const baseUrl = (cfg.baseUrl || settings.room_booking_api_url || "").trim();
  const apiKey = (cfg.apiKey || settings.room_booking_api_key || "").trim();
  const user = (window.HelpCenter && window.HelpCenter.user) || {};

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

  // JSONP request
  function jsonpRequest(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName = "roomJsonpCb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const url = buildUrl(action, Object.assign({}, params, { callback: callbackName }));

      if (!url) {
        reject(new Error("Room booking API URL is invalid."));
        return;
      }

      const script = document.createElement("script");
      let timeoutId = null;

      function cleanup() {
        if (timeoutId) clearTimeout(timeoutId);
        if (window[callbackName]) delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP request failed."));
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("JSONP request timed out."));
      }, 15000);

      script.src = url;
      (document.head || document.body).appendChild(script);
    });
  }

  // Fetch room slots for selected date
  async function fetchRoomSlots() {
    if (!baseUrl || !apiKey) {
      setAlert("Room booking API is not configured.", "error");
      return null;
    }

    const date = dateInput ? dateInput.value : "";
    if (!date) {
      setAlert("Please select a date.", "error");
      return null;
    }

    try {
      const json = await jsonpRequest("room_slots", { date: date });

      if (json && json.success && Array.isArray(json.data.slots)) {
        return json.data.slots;
      }

      throw new Error(json.message || "Failed to load room slots.");
    } catch (error) {
      console.error("Room API error:", error);
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

    if (!payload.requester_name || !payload.requester_email) {
      setAlert("Name and email are required.", "error");
      return;
    }

    if (!payload.purpose) {
      setAlert("Please specify the meeting purpose.", "error");
      return;
    }

    if (bookSubmit) {
      bookSubmit.disabled = true;
      bookSubmit.textContent = "Booking...";
    }

    try {
      const json = await jsonpRequest("book_room", payload);

      if (json && json.success) {
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
        throw new Error(json.message || "Booking failed.");
      }
    } catch (error) {
      setAlert(error.message || "Booking failed. Please try again.", "error");

      if (bookSubmit) {
        bookSubmit.disabled = false;
        bookSubmit.textContent = "Book Now";
      }
    }
  }

  // Initialize
  if (requesterNameInput && user.name) requesterNameInput.value = user.name;
  if (requesterEmailInput && user.email) requesterEmailInput.value = user.email;

  if (filtersForm) {
    filtersForm.addEventListener("submit", (e) => {
      e.preventDefault();
      loadAndRenderCalendar();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (filtersForm) filtersForm.reset();
      setDefaultDate();
      clearAlert();
      if (timelineCalendar) timelineCalendar.hidden = true;
    });
  }

  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (modalCancel) modalCancel.addEventListener("click", closeModal);
  if (modalForm) modalForm.addEventListener("submit", submitBooking);

  // Load on page load
  setDefaultDate();
  loadAndRenderCalendar();
})();
