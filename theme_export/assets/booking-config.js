(function () {
  "use strict";

  // Booking API config helper.
  // Reads config from TRAINING_BOOKING_CFG, data attributes, or theme settings.
  // Falls back to the temporary values below if runtime config is missing.
  // NOTE: Remove these fallback values before any public release.
  const FALLBACK_BASE_URL =
    "https://script.google.com/macros/s/AKfycbxKZUHO8KiN6-oawtgTnXJy9yf2OPUT1hpnRgcrnygAB8SzMv3J5EylrhC4_Dgv0_dX/exec";
  const FALLBACK_API_KEY = "c8032a6a14e04710a701aadd27f8e5d5";

  function getConfig(rootEl) {
    const helpCenter = window.HelpCenter || {};
    const settings = helpCenter.themeSettings || {};
    const cfg = window.TRAINING_BOOKING_CFG || {};
    const root =
      rootEl || document.getElementById("training-booking-root") || null;
    const rootCfg = root
      ? {
          baseUrl: root.getAttribute("data-training-base-url") || "",
          apiKey: root.getAttribute("data-training-api-key") || ""
        }
      : { baseUrl: "", apiKey: "" };

    const baseUrl = (
      cfg.baseUrl ||
      rootCfg.baseUrl ||
      settings.training_api_url ||
      settings.training_api_base_url ||
      ""
    ).trim();
    const apiKey =
      cfg.apiKey || rootCfg.apiKey || settings.training_api_key || "";

    return {
      baseUrl: baseUrl || FALLBACK_BASE_URL,
      apiKey: apiKey || FALLBACK_API_KEY
    };
  }

  window.DigifyBookingConfig = {
    getConfig: getConfig
  };
})();
