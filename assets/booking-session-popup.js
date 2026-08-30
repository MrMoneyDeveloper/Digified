(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BookingSessionPopup = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MESSAGE_TYPE = "digify.booking.session.v1";
  const DEFAULT_TIMEOUT_MS = 90000;

  function publicError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && url.origin === String(value)
        ? url.origin
        : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeBaseUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.toString() : "";
    } catch (_error) {
      return "";
    }
  }

  function isTrustedMessageOrigin(origin, baseUrl) {
    const normalized = normalizeOrigin(origin);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (!normalized || !normalizedBaseUrl) return false;

    const messageUrl = new URL(normalized);
    const deploymentUrl = new URL(normalizedBaseUrl);
    if (messageUrl.origin === deploymentUrl.origin) return true;

    const hostname = messageUrl.hostname.toLowerCase();
    return (
      hostname === "script.googleusercontent.com" ||
      hostname.endsWith(".script.googleusercontent.com") ||
      hostname.endsWith("-script.googleusercontent.com")
    );
  }

  function generateRequestId(cryptoProvider) {
    if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== "function") {
      throw publicError(
        "WEB_CRYPTO_UNAVAILABLE",
        "Secure booking is not supported by this browser."
      );
    }
    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    return Array.from(bytes)
      .map(function (value) {
        return value.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function buildPopupUrl(baseUrl, zendeskOrigin, requestId) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedOrigin = normalizeOrigin(zendeskOrigin);
    if (!normalizedBaseUrl || !normalizedOrigin || !/^[a-f0-9]{32}$/.test(requestId)) {
      throw publicError(
        "SESSION_INIT_CONFIG_INVALID",
        "Secure booking session could not be established."
      );
    }

    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("action", "session_init");
    url.searchParams.set("origin", normalizedOrigin);
    url.searchParams.set("request_id", requestId);
    return url.toString();
  }

  function sourceMatchesPopup(source, popup) {
    if (!source || !popup) return false;
    if (source === popup) return true;

    try {
      for (let index = 0; index < popup.frames.length; index += 1) {
        if (source === popup.frames[index]) return true;
      }
    } catch (_error) {
      // Cross-origin frame inspection is best-effort. Direct popup matching above
      // remains enforced where the browser exposes the top-level source.
    }
    return false;
  }

  function openSession(options) {
    const config = options || {};
    const windowRef = config.windowRef || (typeof window !== "undefined" ? window : null);
    const cryptoProvider = config.cryptoProvider || (windowRef && windowRef.crypto);
    const timeoutMs = Number.isFinite(config.timeoutMs)
      ? Math.max(1000, Number(config.timeoutMs))
      : DEFAULT_TIMEOUT_MS;

    if (!windowRef || !windowRef.location || typeof windowRef.open !== "function") {
      return Promise.reject(
        publicError(
          "SESSION_POPUP_UNAVAILABLE",
          "Secure booking session could not be established."
        )
      );
    }

    const zendeskOrigin = normalizeOrigin(windowRef.location.origin);
    let requestId;
    let popupUrl;
    try {
      requestId = generateRequestId(cryptoProvider);
      popupUrl = buildPopupUrl(config.baseUrl, zendeskOrigin, requestId);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise(function (resolve, reject) {
      const popup = windowRef.open(
        popupUrl,
        "digifyBookingSession_" + requestId,
        "popup=yes,width=520,height=680,resizable=yes,scrollbars=yes"
      );

      if (!popup) {
        if (typeof config.onStatus === "function") config.onStatus("popup_blocked");
        reject(
          publicError(
            "SESSION_POPUP_BLOCKED",
            "Secure booking connection was blocked. Allow popups and retry."
          )
        );
        return;
      }

      try {
        popup.focus();
      } catch (_error) {
        // Focus is a convenience only; authentication can continue without it.
      }

      let settled = false;
      let timeoutId = null;
      let closedPollId = null;

      function cleanup() {
        windowRef.removeEventListener("message", onMessage);
        if (timeoutId !== null) windowRef.clearTimeout(timeoutId);
        if (closedPollId !== null) windowRef.clearInterval(closedPollId);
      }

      function rejectOnce(error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }

      function onMessage(event) {
        if (!isTrustedMessageOrigin(event.origin, config.baseUrl)) return;
        if (!sourceMatchesPopup(event.source, popup)) return;

        const message = event.data;
        if (
          !message ||
          typeof message !== "object" ||
          message.type !== MESSAGE_TYPE ||
          message.request_id !== requestId
        ) {
          return;
        }

        if (message.success !== true || !message.data || typeof message.data !== "object") {
          rejectOnce(
            publicError(
              "SESSION_INIT_REJECTED",
              "Secure booking session could not be established."
            )
          );
          return;
        }

        settled = true;
        cleanup();
        if (typeof config.onStatus === "function") config.onStatus("connected");
        resolve({ success: true, data: message.data });
      }

      windowRef.addEventListener("message", onMessage);
      timeoutId = windowRef.setTimeout(function () {
        if (typeof config.onStatus === "function") config.onStatus("timeout");
        rejectOnce(
          publicError(
            "SESSION_POPUP_TIMEOUT",
            "Secure booking connection timed out. Please retry."
          )
        );
      }, timeoutMs);
      closedPollId = windowRef.setInterval(function () {
        try {
          if (popup.closed) {
            if (typeof config.onStatus === "function") config.onStatus("closed");
            rejectOnce(
              publicError(
                "SESSION_POPUP_CLOSED",
                "Secure booking connection was cancelled. Please retry."
              )
            );
          }
        } catch (_error) {
          // A cross-origin popup is expected; only the readable closed flag matters.
        }
      }, 250);
    });
  }

  function createBootstrap(options) {
    const config = Object.assign({}, options || {});
    return function () {
      return openSession(config);
    };
  }

  return Object.freeze({
    MESSAGE_TYPE: MESSAGE_TYPE,
    buildPopupUrl: buildPopupUrl,
    createBootstrap: createBootstrap,
    generateRequestId: generateRequestId,
    isTrustedMessageOrigin: isTrustedMessageOrigin,
    normalizeOrigin: normalizeOrigin,
    openSession: openSession,
    sourceMatchesPopup: sourceMatchesPopup
  });
});
