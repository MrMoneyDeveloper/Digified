(function () {
  "use strict";

  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/(?:training_booking|room_booking)/.test(path)) return;

  const root = document.getElementById("training-booking-root");
  if (!root) return;

  const ROOM_CONFIGS = {
    "Training Room 1": {
      value: "Training Room 1",
      label: "Training Room 1",
      dayStart: 8 * 60,
      dayEnd: 20 * 60,
      slotMinutes: 30,
      footnote:
        "Training rooms are bookable Monday to Friday between 08:00 and 20:00 in 30-minute steps."
    },
    "Training Room 2": {
      value: "Training Room 2",
      label: "Training Room 2",
      dayStart: 8 * 60,
      dayEnd: 20 * 60,
      slotMinutes: 30,
      footnote:
        "Training rooms are bookable Monday to Friday between 08:00 and 20:00 in 30-minute steps."
    },
    "Interview Room": {
      value: "Interview Room",
      label: "Interview Room (Meeting Room)",
      dayStart: 12 * 60,
      dayEnd: 20 * 60,
      slotMinutes: 60,
      footnote:
        "The interview room is bookable Monday to Friday between 12:00 and 20:00 in 60-minute steps."
    }
  };
  const ROOM_ORDER = Object.keys(ROOM_CONFIGS);
  const DEFAULT_ROOM = ROOM_ORDER[0];
  const MAX_REPEAT_DAYS = 5;
  const TZ = "Africa/Johannesburg";
  const JSONP_TIMEOUT_MS = 60000;
  const ATTENDEE_LABEL_ID = "training-booking-attendees-label";
  const SLOT_MODEL_CACHE = Object.create(null);

  const configProvider = window.DigifyBookingConfig;
  const config =
    configProvider && typeof configProvider.getConfig === "function"
      ? configProvider.getConfig(root)
      : { baseUrl: "", apiKey: "" };
  const baseUrl = String(config.baseUrl || "").trim();
  const apiKey = String(config.apiKey || "").trim();
  const roomPreviewImages = {
    "Training Room 1": String(root.dataset.roomImageTraining1 || "").trim(),
    "Training Room 2": String(root.dataset.roomImageTraining2 || "").trim(),
    "Interview Room": String(root.dataset.roomImageInterview || "").trim()
  };

  const ui = {
    alert: document.getElementById("training-booking-alert"),
    filtersForm: document.getElementById("training-booking-filters"),
    date: document.getElementById("training-date"),
    room: document.getElementById("training-room"),
    repeatDays: document.getElementById("training-repeat-days"),
    load: document.getElementById("training-load"),
    reset: document.getElementById("training-reset"),
    list: document.getElementById("training-booking-list"),
    loading: document.getElementById("training-booking-loading"),
    selection: document.getElementById("training-booking-selection"),
    modal: document.getElementById("training-booking-modal"),
    modalClose: document.getElementById("training-booking-modal-close"),
    modalCancel: document.getElementById("training-booking-modal-cancel"),
    modalForm: document.getElementById("training-booking-form"),
    sessionSummary: document.getElementById("training-booking-session-summary"),
    slotId: document.getElementById("training-booking-slot-id"),
    startDate: document.getElementById("training-booking-start-date"),
    startTime: document.getElementById("training-booking-start-time"),
    endTime: document.getElementById("training-booking-end-time"),
    roomValue: document.getElementById("training-booking-room-value"),
    repeatDaysValue: document.getElementById("training-booking-repeat-days-value"),
    requesterName: document.getElementById("training-booking-requester-name"),
    requesterEmail: document.getElementById("training-booking-requester-email"),
    notes: document.getElementById("training-booking-notes"),
    online: document.getElementById("training-booking-online"),
    attendeesField: document.getElementById("training-booking-attendees-field"),
    attendees: document.getElementById("training-booking-attendees"),
    addAttendee: document.getElementById("training-booking-add-attendee"),
    submit: document.getElementById("training-booking-submit"),
    roomPreview: document.getElementById("training-room-preview"),
    roomPreviewImage: document.getElementById("training-room-preview-image"),
    roomPreviewPlaceholder: document.getElementById("training-room-preview-placeholder"),
    roomPreviewTitle: document.getElementById("training-room-preview-title"),
    roomPreviewCaption: document.getElementById("training-room-preview-caption")
  };

  const errorMessages = {
    FAIL_SLOT_FULL: "One or more selected slots are no longer available.",
    FAIL_ALREADY_BOOKED: "You already have a booking that overlaps this request.",
    FAIL_INVALID_SLOT: "The selected time range is no longer available.",
    FAIL_CANCELLED: "One or more selected slots have been cancelled.",
    FAIL_SLOT_NOT_ALLOWED: "Selected times fall outside permitted booking hours.",
    FAIL_OUTSIDE_HOURS: "Selected times fall outside permitted booking hours.",
    FAIL_INVALID_TIME_RANGE: "Select a valid continuous time range.",
    FAIL_RANGE_OVERLAP: "The selected range overlaps an existing booking.",
    FAIL_REPEAT_CONFLICT: "One or more repeat days are unavailable.",
    UNAUTHORIZED: "API key not accepted."
  };

  const longDateFormatter = new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TZ
  });
  const shortDateFormatter = new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TZ
  });

  const state = {
    room: DEFAULT_ROOM,
    startDate: "",
    repeatDays: 0,
    dates: [],
    lookup: Object.create(null),
    selected: null,
    drag: null,
    cells: new Map(),
    loadRequestId: 0
  };

  function getCurrentUser() {
    if (window.TRAINING_BOOKING_USER && window.TRAINING_BOOKING_USER.isSignedIn) {
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
    if (window.currentUser) {
      return {
        name: window.currentUser.name || "Unknown User",
        email: window.currentUser.email || "unknown@example.com"
      };
    }
    return { name: "Unknown User", email: "unknown@example.com" };
  }

  function resolveUserType() {
    const segments = window.DigifySegments || window.DigifiedSegments || {};
    const isTenant =
      segments.isTenantUser === true ||
      window.isTenantUser === true ||
      document.documentElement.classList.contains("hc-tenant-user");
    return isTenant ? "tenant" : "staff";
  }

  function ensureConfig() {
    if (!baseUrl || !apiKey) {
      throw new Error("Training booking is not configured. Please contact an admin.");
    }
  }

  function updateRoomPreview() {
    if (!ui.roomPreview) return;

    const room = normalizeRoom(ui.room.value || state.room || DEFAULT_ROOM);
    const cfg = getRoomConfig(room);
    const imageUrl = String(roomPreviewImages[room] || "").trim();
    const title = roomLabel(room);

    if (ui.roomPreviewTitle) ui.roomPreviewTitle.textContent = title;
    if (ui.roomPreviewCaption) ui.roomPreviewCaption.textContent = cfg.footnote || "";

    if (ui.roomPreviewImage) {
      ui.roomPreviewImage.onload = function () {
        ui.roomPreviewImage.hidden = false;
        if (ui.roomPreviewPlaceholder) {
          ui.roomPreviewPlaceholder.hidden = true;
        }
      };
      ui.roomPreviewImage.onerror = function () {
        ui.roomPreviewImage.hidden = true;
        ui.roomPreviewImage.removeAttribute("src");
        ui.roomPreviewImage.alt = "";
        if (ui.roomPreviewPlaceholder) {
          ui.roomPreviewPlaceholder.hidden = false;
          ui.roomPreviewPlaceholder.textContent = title;
        }
      };
      if (imageUrl) {
        ui.roomPreviewImage.src = imageUrl;
        ui.roomPreviewImage.alt = title + " preview";
        ui.roomPreviewImage.hidden = false;
      } else {
        ui.roomPreviewImage.hidden = true;
        ui.roomPreviewImage.removeAttribute("src");
        ui.roomPreviewImage.alt = "";
      }
    }

    if (ui.roomPreviewPlaceholder) {
      ui.roomPreviewPlaceholder.hidden = !!imageUrl;
      ui.roomPreviewPlaceholder.textContent = title;
    }
  }

  function setAlert(message, type, options) {
    if (!ui.alert) return;
    ui.alert.className = "tb-alert" + (type ? " tb-alert--" + type : "");
    ui.alert.innerHTML = "";
    ui.alert.appendChild(document.createTextNode(message));
    if (options && options.action && typeof options.action.onClick === "function") {
      ui.alert.appendChild(document.createTextNode(" "));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary";
      button.textContent = options.action.label;
      button.addEventListener("click", options.action.onClick);
      ui.alert.appendChild(button);
    }
    ui.alert.hidden = false;
  }

  function clearAlert() {
    if (!ui.alert) return;
    ui.alert.hidden = true;
    ui.alert.className = "tb-alert";
    ui.alert.textContent = "";
  }

  function setLoading(isLoading) {
    if (ui.loading) ui.loading.hidden = !isLoading;
    if (ui.load) {
      ui.load.disabled = !!isLoading;
      ui.load.textContent = isLoading ? "Refreshing..." : "Refresh";
    }
  }

  function setBookingLoading(isLoading) {
    if (!ui.submit) return;
    ui.submit.disabled = !!isLoading;
    ui.submit.textContent = isLoading ? "Booking..." : "Book now";
    ui.submit.classList.toggle("tb-btn--loading", !!isLoading);
  }

  function resetSubmitButton() {
    if (!ui.submit) return;
    ui.submit.disabled = false;
    ui.submit.textContent = "Book now";
    ui.submit.classList.remove("tb-btn--loading", "tb-btn--booked");
  }

  function buildApiUrl(action, params) {
    let url;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      return "";
    }
    url.searchParams.set("action", action);
    url.searchParams.set("api_key", apiKey);
    Object.keys(params || {}).forEach(function (key) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  function jsonp(action, params) {
    return new Promise(function (resolve, reject) {
      const callbackName =
        "trainingJsonpCb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const url = buildApiUrl(
        action,
        Object.assign({}, params, { callback: callbackName, _ts: Date.now() })
      );
      if (!url) {
        reject(new Error("Training API URL is invalid."));
        return;
      }
      const script = document.createElement("script");
      let timeoutId = null;
      function cleanup() {
        if (timeoutId) clearTimeout(timeoutId);
        if (window[callbackName]) delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
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
      }, JSONP_TIMEOUT_MS);
      script.src = url;
      (document.head || document.body).appendChild(script);
    });
  }

  function apiError(json) {
    if (!json || typeof json !== "object") return "";
    const statusCode = Number(json.statusCode);
    const isError =
      json.success === false ||
      (!Number.isNaN(statusCode) && statusCode !== 0 && statusCode !== 200);
    if (!isError) return "";
    const code = String(json.code || "");
    return errorMessages[code] || String(json.message || "Request failed.");
  }

  function friendlyError(error, fallback) {
    const message = error && error.message ? String(error.message) : "";
    if (message === "JSONP request failed." || message === "JSONP request timed out.") {
      return "Unable to reach the room booking API. Please try again.";
    }
    return message || fallback;
  }

  function todayIsoInTz() {
    const parts = new Intl.DateTimeFormat("en-ZA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const lookup = {};
    parts.forEach(function (part) {
      lookup[part.type] = part.value;
    });
    let date = new Date(
      Date.UTC(
        Number(lookup.year),
        Number(lookup.month) - 1,
        Number(lookup.day)
      )
    );
    while (!isWeekday(date)) {
      date = addDays(date, 1);
    }
    return toIso(date);
  }

  function toIso(date) {
    return (
      String(date.getUTCFullYear()) +
      "-" +
      String(date.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getUTCDate()).padStart(2, "0")
    );
  }

  function parseIso(value) {
    const parts = String(value || "").split("-");
    if (parts.length !== 3) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }

  function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  function isWeekday(date) {
    const day = date.getUTCDay();
    return day >= 1 && day <= 5;
  }

  function formatDate(value, short) {
    const date = parseIso(value);
    if (!date) return String(value || "");
    return (short ? shortDateFormatter : longDateFormatter).format(date);
  }

  function timeLabel(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return String(value || "");
    const parts = String(value).split(":");
    const hour = Number(parts[0]);
    const period = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return hour12 + ":" + parts[1] + " " + period;
  }

  function timeRange(start, end) {
    return timeLabel(start) + " - " + timeLabel(end);
  }

  function minutesToHHMM(minutes) {
    return (
      String(Math.floor(minutes / 60)).padStart(2, "0") +
      ":" +
      String(minutes % 60).padStart(2, "0")
    );
  }

  function hhmmToMinutes(value) {
    const parts = String(value || "").split(":");
    if (parts.length !== 2) return NaN;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return NaN;
    return (hours * 60) + minutes;
  }

  function slotId(date, startTime) {
    return ("SLOT_" + date + "_" + String(startTime).replace(":", "")).toUpperCase();
  }

  function getRoomConfig(value) {
    return ROOM_CONFIGS[normalizeRoom(value)] || ROOM_CONFIGS[DEFAULT_ROOM];
  }

  function roomLabel(value) {
    return getRoomConfig(value).label;
  }

  function timeSlotsForRoom(value) {
    const room = normalizeRoom(value);
    if (!SLOT_MODEL_CACHE[room]) {
      const config = getRoomConfig(room);
      const slots = [];
      for (let m = config.dayStart; m < config.dayEnd; m += config.slotMinutes) {
        slots.push({
          index: slots.length,
          start_time: minutesToHHMM(m),
          end_time: minutesToHHMM(m + config.slotMinutes)
        });
      }
      SLOT_MODEL_CACHE[room] = slots;
    }
    return SLOT_MODEL_CACHE[room];
  }

  function normalizeRoom(value) {
    const raw = String(value || "").trim();
    if (!raw) return DEFAULT_ROOM;
    if (ROOM_CONFIGS[raw]) return raw;
    if (raw.toLowerCase() === "meeting room") return "Interview Room";
    return DEFAULT_ROOM;
  }

  function displayDates(startDate, repeatDays) {
    const start = parseIso(startDate);
    if (!start || !isWeekday(start)) return [];
    const dates = [startDate];
    let cursor = start;
    while (dates.length < repeatDays + 1) {
      cursor = addDays(cursor, 1);
      if (isWeekday(cursor)) dates.push(toIso(cursor));
    }
    return dates;
  }

  function sessionLookup(sessions) {
    const lookup = Object.create(null);
    sessions.forEach(function (session) {
      if (!lookup[session.date]) lookup[session.date] = Object.create(null);
      lookup[session.date][session.start_time] = session;
    });
    return lookup;
  }

  function normalizeSession(session) {
    const date = String(session.date || "").trim();
    const start = String(session.start_time || "").trim();
    const end = String(session.end_time || "").trim();
    if (!date || !start || !end) return null;
    const status = String(session.status || "").trim().toLowerCase();
    return {
      date: date,
      start_time: start,
      end_time: end,
      dept: normalizeRoom(session.dept || state.room),
      available:
        session.available !== false &&
        status !== "full" &&
        status !== "cancelled" &&
        session.booked !== true,
      status: status || "open",
      reserved_by: String(
        session.reserved_by || session.vendor || session.booker_name || ""
      ).trim()
    };
  }

  function availability(date, slotIndex) {
    const slot = timeSlotsForRoom(state.room)[slotIndex];
    const session =
      state.lookup[date] && slot ? state.lookup[date][slot.start_time] : null;
    if (!session) {
      return { available: false, status: "full", reserved_by: "" };
    }
    return session;
  }

  function cellKey(date, slotIndex) {
    return date + "|" + slotIndex;
  }

  function buildRange(anchorIndex, currentIndex) {
    const slots = timeSlotsForRoom(state.room);
    const config = getRoomConfig(state.room);
    const startIndex =
      config.slotMinutes === 60
        ? currentIndex
        : Math.min(anchorIndex, currentIndex);
    const endIndex =
      config.slotMinutes === 60
        ? currentIndex
        : Math.max(anchorIndex, currentIndex);
    return {
      slot_id: slotId(state.startDate, slots[startIndex].start_time),
      start_date: state.startDate,
      start_time: slots[startIndex].start_time,
      end_time: slots[endIndex].end_time,
      room: state.room,
      repeat_days: state.repeatDays,
      dates: state.dates.slice(),
      start_index: startIndex,
      end_index: endIndex
    };
  }

  function rangeIssues(range) {
    const issues = [];
    range.dates.forEach(function (date) {
      for (let i = range.start_index; i <= range.end_index; i += 1) {
        if (!availability(date, i).available) {
          issues.push(cellKey(date, i));
        }
      }
    });
    return new Set(issues);
  }

  function paintSelection() {
    state.cells.forEach(function (cell) {
      cell.classList.remove(
        "tb-cell--preview",
        "tb-cell--selected",
        "tb-cell--mirrored",
        "tb-cell--preview-invalid",
        "tb-cell--repeat-conflict"
      );
    });
    const active = state.drag
      ? buildRange(state.drag.anchor, state.drag.current)
      : state.selected;
    if (!active) return;
    const issues = rangeIssues(active);
    active.dates.forEach(function (date) {
      for (let i = active.start_index; i <= active.end_index; i += 1) {
        const cell = state.cells.get(cellKey(date, i));
        if (!cell) continue;
        cell.classList.add(
          date === active.start_date
            ? state.drag
              ? "tb-cell--preview"
              : "tb-cell--selected"
            : "tb-cell--mirrored"
        );
        if (issues.has(cellKey(date, i))) {
          cell.classList.add(
            date === active.start_date
              ? "tb-cell--preview-invalid"
              : "tb-cell--repeat-conflict"
          );
        }
      }
    });
  }

  function writeSelectionFields() {
    ui.slotId.value = state.selected ? state.selected.slot_id : "";
    ui.startDate.value = state.selected ? state.selected.start_date : "";
    ui.startTime.value = state.selected ? state.selected.start_time : "";
    ui.endTime.value = state.selected ? state.selected.end_time : "";
    ui.roomValue.value = state.selected ? state.selected.room : "";
    ui.repeatDaysValue.value = state.selected
      ? String(state.selected.repeat_days)
      : "0";
  }

  function renderSelectionSummary() {
    if (!ui.selection) return;
    if (!state.selected) {
      ui.selection.hidden = true;
      ui.selection.innerHTML = "";
      return;
    }
    const repeated = state.selected.dates
      .slice(1)
      .map(function (date) {
        return formatDate(date, true);
      })
      .join(", ");
    ui.selection.innerHTML =
      '<span class="tb-selection-summary__label">Selected window</span>' +
      '<p class="tb-selection-summary__text">' +
      roomLabel(state.selected.room) +
      " on " +
      formatDate(state.selected.start_date, false) +
      " from " +
      timeRange(state.selected.start_time, state.selected.end_time) +
      (repeated ? ". Repeats on " + repeated + "." : ".") +
      "</p>" +
      '<p class="tb-selection-summary__hint">Drag again if you want to change the time range.</p>';
    ui.selection.hidden = false;
  }

  function setSelection(range) {
    state.selected = range;
    writeSelectionFields();
    renderSelectionSummary();
    paintSelection();
  }

  function clearSelection() {
    state.selected = null;
    writeSelectionFields();
    renderSelectionSummary();
    paintSelection();
  }

  function clearDrag() {
    state.drag = null;
    document.body.classList.remove("tb-dragging");
  }

  function finishDrag() {
    if (!state.drag) return;
    const range = buildRange(state.drag.anchor, state.drag.current);
    const issues = rangeIssues(range);
    clearDrag();
    if (issues.size) {
      paintSelection();
      setAlert(
        "Some selected slots are unavailable for the chosen room or repeat days.",
        "error"
      );
      return;
    }
    clearAlert();
    setSelection(range);
    openModal();
  }

  function handleCellEnter(event) {
    if (!state.drag) return;
    if (String(event.currentTarget.dataset.date || "") !== state.startDate) return;
    state.drag.current = Number(event.currentTarget.dataset.slotIndex);
    paintSelection();
  }

  function handleCellDown(event) {
    if (event.currentTarget.dataset.interactive !== "1") return;
    event.preventDefault();
    state.drag = {
      anchor: Number(event.currentTarget.dataset.slotIndex),
      current: Number(event.currentTarget.dataset.slotIndex)
    };
    document.body.classList.add("tb-dragging");
    paintSelection();
  }

  function cellTitle(date, slot, info, primary) {
    const label = formatDate(date, true) + " " + timeRange(slot.start_time, slot.end_time);
    if (info.available && primary) {
      return getRoomConfig(state.room).slotMinutes === 60
        ? "Select " + label + "."
        : "Drag to select " + label + ".";
    }
    if (info.available) return "Repeat-day preview for " + label + ".";
    if (info.reserved_by) return label + " is booked by " + info.reserved_by + ".";
    return label + " is unavailable.";
  }

  function renderPlaceholder(message) {
    state.cells = new Map();
    ui.list.innerHTML = '<div class="tb-placeholder">' + message + "</div>";
  }

  function renderCalendar() {
    state.cells = new Map();
    if (!state.dates.length) {
      renderPlaceholder("Select a weekday to load the room calendar.");
      return;
    }

    const roomConfig = getRoomConfig(state.room);
    const slots = timeSlotsForRoom(state.room);
    const wrapper = document.createElement("section");
    wrapper.className = "tb-calendar";
    wrapper.innerHTML =
      '<div class="tb-calendar__header"><div><h2 class="tb-calendar__title">' +
      roomLabel(state.room) +
      ' availability</h2><p class="tb-calendar__subtitle">' +
      (state.repeatDays
        ? "Drag on the first day column. The same time span will be checked against the next " +
          state.repeatDays +
          " weekday(s)."
        : roomConfig.slotMinutes === 60
          ? "Select a single interview slot on the first day column."
          : "Drag on the first day column to choose a continuous time range.") +
      '</p></div><div class="tb-legend"></div></div><div class="tb-calendar__body"><div class="tb-calendar__shell"><div class="tb-calendar-grid"></div></div><p class="tb-calendar__footnote">' +
      roomConfig.footnote +
      "</p></div>";

    const legend = wrapper.querySelector(".tb-legend");
    [
      ["Open slot", "open"],
      ["Unavailable", "booked"],
      ["Selected", "selected"],
      ["Repeat preview", "repeat"]
    ].forEach(function (entry) {
      const item = document.createElement("span");
      item.className = "tb-legend__item";
      item.innerHTML =
        '<span class="tb-legend__swatch tb-legend__swatch--' +
        entry[1] +
        '"></span><span>' +
        entry[0] +
        "</span>";
      legend.appendChild(item);
    });

    const grid = wrapper.querySelector(".tb-calendar-grid");
    grid.style.setProperty("--tb-day-count", String(state.dates.length));

    const corner = document.createElement("div");
    corner.className = "tb-calendar-corner";
    corner.textContent = "Time";
    grid.appendChild(corner);

    state.dates.forEach(function (date, index) {
      const day = document.createElement("div");
      day.className =
        "tb-calendar-day" + (index === 0 ? " tb-calendar-day--primary" : "");
      day.innerHTML =
        '<span class="tb-calendar-day__dow">' +
        formatDate(date, true).split(" ")[0] +
        '</span><span class="tb-calendar-day__date">' +
        formatDate(date, true) +
        "</span>";
      grid.appendChild(day);
    });

    slots.forEach(function (slot) {
      const label = document.createElement("div");
      label.className = "tb-time-label";
      label.textContent = timeLabel(slot.start_time);
      grid.appendChild(label);

      state.dates.forEach(function (date, columnIndex) {
        const info = availability(date, slot.index);
        const primary = columnIndex === 0;
        const interactive = primary && info.available;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "tb-cell";
        cell.dataset.date = date;
        cell.dataset.slotIndex = String(slot.index);
        cell.dataset.interactive = interactive ? "1" : "0";
        cell.tabIndex = interactive ? 0 : -1;
        cell.title = cellTitle(date, slot, info, primary);
        cell.setAttribute("aria-label", cell.title);
        if (info.available) {
          cell.classList.add(primary ? "tb-cell--open" : "tb-cell--secondary");
        } else {
          cell.classList.add("tb-cell--blocked");
          if (info.status === "cancelled") cell.classList.add("tb-cell--cancelled");
        }
        if (primary) {
          cell.addEventListener("pointerdown", handleCellDown);
          cell.addEventListener("pointerenter", handleCellEnter);
        }
        state.cells.set(cellKey(date, slot.index), cell);
        grid.appendChild(cell);
      });
    });

    ui.list.innerHTML = "";
    ui.list.appendChild(wrapper);
    paintSelection();
  }

  function syncState() {
    state.startDate = String(ui.date.value || "").trim();
    state.room = normalizeRoom(ui.room.value);
    state.repeatDays = Math.min(
      Math.max(Number(ui.repeatDays.value || 0), 0),
      MAX_REPEAT_DAYS
    );
    state.dates = displayDates(state.startDate, state.repeatDays);
    updateRoomPreview();
  }

  async function loadCalendar(options) {
    const preserveAlert = options && options.preserveAlert === true;
    const preserveViewOnError = options && options.preserveViewOnError === true;
    if (!preserveAlert) clearAlert();
    try {
      ensureConfig();
    } catch (error) {
      setAlert(error.message, "error");
      return;
    }

    syncState();
    clearSelection();

    const requestId = ++state.loadRequestId;
    const requestStartDate = state.startDate;
    const requestRoom = state.room;
    const requestDates = state.dates.slice();

    if (!requestStartDate) {
      renderPlaceholder("Select a date to load the room calendar.");
      setAlert("Select a valid date.", "error");
      return;
    }
    if (!requestDates.length) {
      renderPlaceholder("Rooms can only be booked on weekdays.");
      setAlert("Rooms are available Monday to Friday only.", "error");
      return;
    }

    setLoading(true);
    try {
      const json = await jsonp("sessions", {
        from: requestStartDate,
        to: requestDates[requestDates.length - 1],
        dept: requestRoom
      });
      if (requestId !== state.loadRequestId) return;
      const message = apiError(json);
      if (message) throw new Error(message);
      const source =
        json && json.data && Array.isArray(json.data.sessions)
          ? json.data.sessions
          : json && json.data && Array.isArray(json.data.slots)
            ? json.data.slots
            : [];
      state.lookup = sessionLookup(
        source
          .map(normalizeSession)
          .filter(function (session) {
            return session && session.dept === requestRoom;
          })
      );
      renderCalendar();
    } catch (error) {
      if (requestId !== state.loadRequestId) return;
      if (!preserveViewOnError || !ui.list.querySelector(".tb-calendar")) {
        renderPlaceholder("Unable to load the room calendar right now.");
      }
      if (!preserveAlert) {
        setAlert(friendlyError(error, "Unable to load availability."), "error", {
          action: { label: "Retry", onClick: loadCalendar }
        });
      }
    } finally {
      if (requestId === state.loadRequestId) setLoading(false);
    }
  }

  function updateModalSummary() {
    if (!state.selected) {
      ui.sessionSummary.textContent = "";
      return;
    }
    const repeated = state.selected.dates
      .slice(1)
      .map(function (date) {
        return formatDate(date, true);
      })
      .join(", ");
    ui.sessionSummary.textContent =
      "Room: " +
      roomLabel(state.selected.room) +
      " | Date: " +
      formatDate(state.selected.start_date, false) +
      " | Time: " +
      timeRange(state.selected.start_time, state.selected.end_time) +
      (repeated ? " | Repeats: " + repeated : "");
  }

  function setAttendeesVisible(show) {
    ui.attendeesField.hidden = !show;
    if (!show) ui.attendees.innerHTML = "";
    if (show && !ui.attendees.querySelector("input")) addAttendeeInput();
  }

  function addAttendeeInput(value) {
    const existingInputs = ui.attendees.querySelectorAll("input").length;
    const input = document.createElement("input");
    input.type = "email";
    input.className = "form-control";
    input.name = "attendee_emails[]";
    input.id = "training-booking-attendee-" + String(existingInputs + 1);
    input.setAttribute("aria-labelledby", ATTENDEE_LABEL_ID);
    input.placeholder = "Attendee email";
    if (value) input.value = value;
    ui.attendees.appendChild(input);
    return input;
  }

  function resetModalForm() {
    ui.modalForm.reset();
    ui.modalForm.style.display = "";
    const currentUser = getCurrentUser();
    ui.requesterName.value = currentUser.name;
    ui.requesterEmail.value = currentUser.email;
    ui.requesterName.readOnly = true;
    ui.requesterEmail.readOnly = true;
    ui.requesterName.style.backgroundColor = "#f5f5f5";
    ui.requesterEmail.style.backgroundColor = "#f5f5f5";
    ui.requesterName.style.cursor = "not-allowed";
    ui.requesterEmail.style.cursor = "not-allowed";
    setAttendeesVisible(false);
    const confirmation = ui.modal.querySelector(".tb-booking-confirmation");
    if (confirmation) confirmation.remove();
    resetSubmitButton();
    writeSelectionFields();
    updateModalSummary();
  }

  function openModal() {
    if (!state.selected) return;
    resetModalForm();
    ui.modal.hidden = false;
    ui.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("tb-modal-open");
  }

  function closeModal() {
    ui.modal.hidden = true;
    ui.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("tb-modal-open");
    resetModalForm();
  }

  function attendeeEmails() {
    return Array.from(ui.attendees.querySelectorAll("input"))
      .map(function (input) {
        return String(input.value || "").trim();
      })
      .filter(Boolean);
  }

  function validatePayload(payload) {
    if (!payload.start_date || !payload.start_time || !payload.end_time) {
      return getRoomConfig(state.room).slotMinutes === 60
        ? "Please select an interview room slot."
        : "Please drag across the calendar to select a time range.";
    }
    if (!payload.dept) return "Please choose a room.";
    if (!payload.requester_name || !payload.requester_email) {
      return "Requester details are required.";
    }
    if (payload.meeting_type === "in_person_plus_online") {
      if (!payload.attendee_emails.length) {
        return "Please add at least one attendee email for remote participants.";
      }
      const invalid = payload.attendee_emails.find(function (email) {
        return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      });
      if (invalid) return "Please enter valid attendee email addresses.";
    }
    return "";
  }

  function bookingPayload() {
    const online = !!ui.online.checked;
    const room = ui.roomValue.value || state.room;
    const notes = String(ui.notes.value || "").trim();
    return {
      slot_id: ui.slotId.value,
      start_date: ui.startDate.value,
      start_time: ui.startTime.value,
      end_time: ui.endTime.value,
      dept: room,
      repeat_days: Number(ui.repeatDaysValue.value || 0),
      requester_name: String(ui.requesterName.value || "").trim(),
      requester_email: String(ui.requesterEmail.value || "").trim(),
      user_type: resolveUserType(),
      notes: notes ? "Book " + room + " - " + notes : "Book " + room,
      meeting_type: online ? "in_person_plus_online" : "in_person_only",
      attendee_emails: online ? attendeeEmails() : []
    };
  }

  function showConfirmation(email, count) {
    ui.modalForm.style.display = "none";
    const wrapper = document.createElement("div");
    wrapper.className = "tb-booking-confirmation";
    wrapper.innerHTML =
      '<div class="tb-booking-confirmation__body"><h2>Booked</h2><p>' +
      (count > 1
        ? "Your room bookings have been confirmed."
        : "Your room booking has been confirmed.") +
      '</p><p class="tb-booking-confirmation__note">A confirmation email has been sent to <strong>' +
      String(email || "your email") +
      "</strong>.</p></div>";
    ui.modalForm.parentNode.insertBefore(wrapper, ui.modalForm);
  }

  function applyOptimisticBooking(payload) {
    const room = normalizeRoom(payload.dept || state.room);
    const dates = displayDates(payload.start_date, Number(payload.repeat_days || 0));
    const slots = timeSlotsForRoom(room);
    const startMinutes = hhmmToMinutes(payload.start_time);
    const endMinutes = hhmmToMinutes(payload.end_time);
    if (!dates.length || Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
      return;
    }

    dates.forEach(function (date) {
      if (!state.lookup[date]) state.lookup[date] = Object.create(null);
      slots.forEach(function (slot) {
        const slotStart = hhmmToMinutes(slot.start_time);
        const slotEnd = hhmmToMinutes(slot.end_time);
        if (slotStart >= startMinutes && slotEnd <= endMinutes) {
          state.lookup[date][slot.start_time] = {
            date: date,
            start_time: slot.start_time,
            end_time: slot.end_time,
            dept: room,
            available: false,
            status: "full",
            reserved_by: String(payload.requester_name || "").trim()
          };
        }
      });
    });
  }

  function handleBookingResponse(json, payload) {
    const message = apiError(json);
    if (message) {
      setAlert(message, "error");
      return false;
    }
    const data = json && json.data ? json.data : {};
    const bookingCount =
      Number(data.booking_count) ||
      (Array.isArray(data.bookings) ? data.bookings.length : 1);
    const bookingId =
      data.booking_id ||
      (Array.isArray(data.booking_ids) && data.booking_ids.length
        ? data.booking_ids[0]
        : "");
    setAlert(
      (bookingCount > 1
        ? "Booking confirmed for " + bookingCount + " days."
        : "Booking confirmed.") +
        (bookingId ? " Booking ID " + bookingId + "." : "") +
        " Zendesk ticket creation will continue automatically.",
      "success"
    );
    ui.submit.disabled = true;
    ui.submit.textContent = "Booked";
    ui.submit.classList.add("tb-btn--booked");
    showConfirmation(payload.requester_email, bookingCount);
    return true;
  }

  async function submitBooking(event) {
    event.preventDefault();
    clearAlert();
    if (!ui.modalForm.checkValidity()) {
      ui.modalForm.reportValidity();
      return;
    }
    const payload = bookingPayload();
    const validation = validatePayload(payload);
    if (validation) {
      setAlert(validation, "error");
      return;
    }

    setBookingLoading(true);
    try {
      const json = await jsonp("book", {
        slot_id: payload.slot_id,
        start_date: payload.start_date,
        start_time: payload.start_time,
        end_time: payload.end_time,
        requester_name: payload.requester_name,
        requester_email: payload.requester_email,
        user_type: payload.user_type,
        notes: payload.notes,
        meeting_type: payload.meeting_type,
        attendee_emails: payload.attendee_emails.join(","),
        dept: payload.dept,
        repeat_days: String(payload.repeat_days || 0)
      });
      if (!handleBookingResponse(json, payload)) {
        resetSubmitButton();
        return;
      }
      applyOptimisticBooking(payload);
      setTimeout(function () {
        closeModal();
        clearSelection();
        renderCalendar();
      }, 1800);
    } catch (error) {
      setAlert(friendlyError(error, "Booking failed."), "error", {
        action: { label: "Retry", onClick: submitBooking }
      });
      resetSubmitButton();
    } finally {
      setBookingLoading(false);
    }
  }

  ui.date.value = ui.date.value || todayIsoInTz();
  ui.room.value = ui.room.value || DEFAULT_ROOM;
  ui.repeatDays.value = ui.repeatDays.value || "0";

  const currentUser = getCurrentUser();
  ui.requesterName.value = currentUser.name;
  ui.requesterEmail.value = currentUser.email;

  ui.filtersForm.addEventListener("submit", function (event) {
    event.preventDefault();
    loadCalendar();
  });
  ui.reset.addEventListener("click", function () {
    ui.filtersForm.reset();
    ui.date.value = todayIsoInTz();
    ui.room.value = DEFAULT_ROOM;
    ui.repeatDays.value = "0";
    clearAlert();
    clearSelection();
    loadCalendar();
  });
  [ui.date, ui.room, ui.repeatDays].forEach(function (field) {
    field.addEventListener("change", function () {
      loadCalendar();
    });
  });
  ui.online.addEventListener("change", function () {
    setAttendeesVisible(ui.online.checked);
  });
  ui.addAttendee.addEventListener("click", function () {
    if (ui.online.checked) addAttendeeInput();
  });
  ui.modalClose.addEventListener("click", closeModal);
  ui.modalCancel.addEventListener("click", closeModal);
  ui.modal.addEventListener("click", function (event) {
    if (event.target === ui.modal) closeModal();
  });
  ui.modalForm.addEventListener("submit", submitBooking);

  document.addEventListener("pointerup", finishDrag);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (state.drag) {
        clearDrag();
        paintSelection();
      } else if (!ui.modal.hidden) {
        closeModal();
      }
    }
  });

  loadCalendar();
})();
