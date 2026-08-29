(function () {
  "use strict";

  // Exported-theme copy of the booking config helper. No credential belongs in
  // a Help Center asset. The Apps Script deployment is restricted to the
  // Google Workspace domain; this sentinel is deliberately non-secret and only
  // keeps the legacy calendar client interface compatible.
  const WORKSPACE_AUTH_SENTINEL = "workspace-auth";

  function normalizeConfig(cfg) {
    return {
      baseUrl: cfg && cfg.baseUrl ? String(cfg.baseUrl).trim() : ""
    };
  }

  function getConfig(root) {
    const settings =
      (window.HelpCenter && window.HelpCenter.themeSettings) || {};
    const rootData = root && root.dataset ? root.dataset : {};
    const runtimeTraining = normalizeConfig(window.TRAINING_BOOKING_CFG || {});
    const runtimeRoom = normalizeConfig(window.ROOM_BOOKING_CFG || {});
    const runtime = runtimeTraining.baseUrl ? runtimeTraining : runtimeRoom;

    const baseUrl =
      runtime.baseUrl ||
      rootData.trainingBaseUrl ||
      rootData.roomBaseUrl ||
      settings.training_api_url ||
      settings.room_booking_api_url ||
      settings.room_booking_api_base_url ||
      "";

    const normalizedBaseUrl = String(baseUrl || "").trim();
    return {
      baseUrl: normalizedBaseUrl,
      apiKey: normalizedBaseUrl ? WORKSPACE_AUTH_SENTINEL : ""
    };
  }

  window.DigifyBookingConfig = {
    getConfig: getConfig
  };
})();
