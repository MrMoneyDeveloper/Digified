(function () {
  "use strict";

  // Booking API config helper.
  // The Apps Script URL is public configuration; authentication is enforced by
  // the Google Workspace DOMAIN web-app deployment. No credential is stored in
  // the Zendesk Help Center bundle.
  //
  // WORKSPACE_AUTH_SENTINEL is deliberately non-secret. It is retained only
  // for backward compatibility with calendar code that still expects an apiKey
  // string and appends it to requests. The backend's real security boundary is
  // Google Workspace sign-in, not this value.
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
