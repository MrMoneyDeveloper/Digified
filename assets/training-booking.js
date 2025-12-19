(function () {
  "use strict";

  const TRAINING_API_ENDPOINT =
    "https://script.google.com/macros/s/AKfycbxKZUHO8KiN6-oawtgTnXJy9yf2OPUT1hpnRgcrnygAB8SzMv3J5EylrhC4_Dgv0_dX/exec";
  const TRAINING_API_KEY = window.TrainingApiKey || "";
  const ZENDESK_SUBDOMAIN = "cxe-internal";
  const ZENDESK_API_TOKEN = "";
  const ZENDESK_FORM_ID = null;
  const APP_ID = "training-booking-app";

  function getApp() {
    return document.getElementById(APP_ID);
  }

  function renderMessage(message, type) {
    const app = getApp();
    if (!app) {
      return;
    }

    const messageEl = document.createElement("p");
    messageEl.className = "training-booking__message";
    if (type) {
      messageEl.className += " training-booking__message--" + type;
    }
    messageEl.textContent = message;

    app.innerHTML = "";
    app.appendChild(messageEl);
  }

  function createCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text || "";
    return cell;
  }

  function formatTimeRange(session) {
    const start = session.start_time || "";
    const end = session.end_time || "";

    if (start && end) {
      return start + " - " + end;
    }

    return start || end;
  }

  function sessionStatus(session) {
    if (session.available) {
      return "Open";
    }

    if (session.status === "cancelled") {
      return "Cancelled";
    }

    return "Full";
  }

  async function loadSessions() {
    if (!TRAINING_API_KEY) {
      throw new Error("Training API key is missing.");
    }

    const url =
      TRAINING_API_ENDPOINT +
      "?action=sessions&api_key=" +
      encodeURIComponent(TRAINING_API_KEY);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error("Failed to load sessions (" + response.status + ").");
    }

    const json = await response.json();
    if (json && json.data && Array.isArray(json.data.sessions)) {
      return json.data.sessions;
    }

    return [];
  }

  function renderSessions(sessions) {
    const app = getApp();
    if (!app) {
      return;
    }

    if (!sessions.length) {
      renderMessage("No sessions are available right now.", "empty");
      return;
    }

    const table = document.createElement("table");
    table.className = "table training-sessions";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Date", "Time", "Vendor", "Topic", "Status", ""].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    sessions.forEach((session) => {
      const row = document.createElement("tr");
      row.appendChild(createCell(session.date));
      row.appendChild(createCell(formatTimeRange(session)));
      row.appendChild(createCell(session.vendor));
      row.appendChild(createCell(session.topic));
      row.appendChild(createCell(sessionStatus(session)));

      const actionCell = document.createElement("td");
      if (session.available && session.slot_id) {
        const slotId = session.slot_id;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-primary";
        button.textContent = "Book";
        button.addEventListener("click", function () {
          bookSlot(slotId, button);
        });
        actionCell.appendChild(button);
      } else {
        const status = document.createElement("span");
        status.className = "training-booking__disabled";
        status.textContent = "Unavailable";
        actionCell.appendChild(status);
      }
      row.appendChild(actionCell);

      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    app.innerHTML = "";
    app.appendChild(table);
  }

  async function bookSlot(slotId, button) {
    if (!TRAINING_API_KEY) {
      alert("Training API key is missing. Please contact support.");
      return;
    }

    const helpCenter = window.HelpCenter || {};
    const user = helpCenter.user || {};
    if (!user.email) {
      alert("Please sign in to book a session.");
      return;
    }

    if (!slotId) {
      alert("That slot is no longer available.");
      return;
    }

    const payload = {
      action: "book",
      slot_id: slotId,
      requester_email: user.email,
      requester_name: user.name || user.email,
      dept: "IT",
      notes: "",
    };

    const originalLabel = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Booking...";
    }

    try {
      const response = await fetch(
        TRAINING_API_ENDPOINT +
          "?api_key=" +
          encodeURIComponent(TRAINING_API_KEY),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await response.json();

      if (!response.ok || !json || !json.success) {
        const message = (json && json.message) || "Booking failed.";
        throw new Error(message);
      }

      const ticketId =
        json.data &&
        json.data.zendesk &&
        json.data.zendesk.ticket_id;
      alert(
        "Booking successful! Your ticket number is " +
          (ticketId || "pending") +
          "."
      );
      await loadAndRender();
    } catch (error) {
      console.error("[Training booking] Booking failed", error);
      alert(
        "Booking failed: " +
          (error && error.message ? error.message : "Please try again.")
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel || "Book";
      }
    }
  }

  async function loadAndRender() {
    const app = getApp();
    if (!app) {
      return;
    }

    if (!TRAINING_API_KEY) {
      renderMessage(
        "Training API key is not configured. Please contact support.",
        "error"
      );
      return;
    }

    renderMessage("Loading sessions...", "loading");
    try {
      const sessions = await loadSessions();
      renderSessions(sessions);
    } catch (error) {
      console.error("[Training booking] Failed to load sessions", error);
      renderMessage(
        "Unable to load sessions right now. Please try again later.",
        "error"
      );
    }
  }

  document.addEventListener("DOMContentLoaded", loadAndRender);
})();
