(function () {
  "use strict";

  // Booking API config helper.
  // Prioritizes explicit runtime window config first, then per-page dataset,
  // then theme settings, and finally the hardcoded fallback below.
  // This keeps repo-pinned API values authoritative even if Zendesk theme
  // settings are stale.
  // NOTE: Remove these fallback values before any public release.
  const FALLBACK_BOOKING_CONFIG = {
    baseUrl:
      "https://script.google.com/macros/s/AKfycbwLge7qDCPemVqE2MsmB11HTZBOJcjFWYjj5yNLGzXKh_qVieGo8Yf5QWVTqt7xB_FU/exec",
    apiKey: "c8032a6a14e04710a701aadd27f8e5d5"
  };

  function normalizeConfig(cfg) {
    return {
      baseUrl: cfg && cfg.baseUrl ? String(cfg.baseUrl).trim() : "",
      apiKey: cfg && cfg.apiKey ? String(cfg.apiKey).trim() : ""
    };
  }

  function getConfig(root) {
    const settings =
      (window.HelpCenter && window.HelpCenter.themeSettings) || {};
    const rootData = root && root.dataset ? root.dataset : {};
    const runtimeTraining = normalizeConfig(window.TRAINING_BOOKING_CFG || {});
    const runtimeRoom = normalizeConfig(window.ROOM_BOOKING_CFG || {});
    const runtime =
      (runtimeTraining.baseUrl || runtimeTraining.apiKey)
        ? runtimeTraining
        : runtimeRoom;
    const runtimeIsTraining =
      !!(runtimeTraining.baseUrl || runtimeTraining.apiKey);
    const fallback = FALLBACK_BOOKING_CONFIG || { baseUrl: "", apiKey: "" };

    const rootBaseUrl =
      rootData.trainingBaseUrl ||
      rootData.roomBaseUrl ||
      "";
    const rootApiKey =
      rootData.trainingApiKey ||
      rootData.roomApiKey ||
      "";

    const settingsBaseUrl =
      settings.training_api_url ||
      settings.room_booking_api_url ||
      settings.room_booking_api_base_url ||
      "";
    const settingsApiKey =
      settings.training_api_key ||
      settings.room_booking_api_key ||
      "";

    const runtimeBaseUrl = runtime.baseUrl || "";
    const runtimeApiKey = runtime.apiKey || "";

    const useRuntimeBaseUrl =
      runtimeBaseUrl &&
      (!runtimeIsTraining ||
        runtimeBaseUrl === fallback.baseUrl ||
        !fallback.baseUrl);
    const useRuntimeApiKey =
      runtimeApiKey &&
      (!runtimeIsTraining ||
        runtimeApiKey === fallback.apiKey ||
        !fallback.apiKey);

    const baseUrl =
      (useRuntimeBaseUrl ? runtimeBaseUrl : "") ||
      rootBaseUrl ||
      settingsBaseUrl ||
      fallback.baseUrl ||
      "";

    const apiKey =
      (useRuntimeApiKey ? runtimeApiKey : "") ||
      rootApiKey ||
      settingsApiKey ||
      fallback.apiKey ||
      "";

    return {
      baseUrl: String(baseUrl || "").trim(),
      apiKey: String(apiKey || "").trim()
    };
  }

  window.DigifyBookingConfig = {
    getConfig: getConfig
  };
})();
