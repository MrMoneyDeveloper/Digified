(function () {
  "use strict";

  // Booking API config helper.
  // Reads config from window.ROOM_BOOKING_CFG first, then falls back.
  // Falls back to the temporary values below if runtime config is missing.
  // NOTE: Remove these fallback values before any public release.
  const FALLBACK_BOOKING_CONFIG = {
    baseUrl:
      "https://script.google.com/macros/s/AKfycbxKZUHO8KiN6-oawtgTnXJy9yf2OPUT1hpnRgcrnygAB8SzMv3J5EylrhC4_Dgv0_dX/exec",
    apiKey: "c8032a6a14e04710a701aadd27f8e5d5"
  };

  function normalizeConfig(cfg) {
    return {
      baseUrl: cfg && cfg.baseUrl ? String(cfg.baseUrl).trim() : "",
      apiKey: cfg && cfg.apiKey ? String(cfg.apiKey).trim() : ""
    };
  }

  function getConfig() {
    const runtime = normalizeConfig(window.ROOM_BOOKING_CFG || {});
    const fallback = FALLBACK_BOOKING_CONFIG || { baseUrl: "", apiKey: "" };
    return {
      baseUrl: runtime.baseUrl || fallback.baseUrl || "",
      apiKey: runtime.apiKey || fallback.apiKey || ""
    };
  }

  window.DigifyBookingConfig = {
    getConfig: getConfig
  };
})();
