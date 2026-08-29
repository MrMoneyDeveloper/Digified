(function () {
  "use strict";

  // Public transport configuration only. Authentication is established at
  // runtime by booking-security.js and is never stored in the page or browser.
  const DEFAULT_PUBLIC_BOOKING_CONFIG = {
    baseUrl:
      "https://script.google.com/macros/s/AKfycbwLge7qDCPemVqE2MsmB11HTZBOJcjFWYjj5yNLGzXKh_qVieGo8Yf5QWVTqt7xB_FU/exec"
  };

  function normalizeBaseUrl(value) {
    return value ? String(value).trim() : "";
  }

  function getConfig(root) {
    const settings =
      (window.HelpCenter && window.HelpCenter.themeSettings) || {};
    const rootData = root && root.dataset ? root.dataset : {};
    const runtimeTraining = window.TRAINING_BOOKING_CFG || {};
    const runtimeRoom = window.ROOM_BOOKING_CFG || {};

    const baseUrl =
      normalizeBaseUrl(runtimeTraining.baseUrl) ||
      normalizeBaseUrl(runtimeRoom.baseUrl) ||
      normalizeBaseUrl(rootData.trainingBaseUrl) ||
      normalizeBaseUrl(rootData.roomBaseUrl) ||
      normalizeBaseUrl(settings.training_api_url) ||
      normalizeBaseUrl(settings.room_booking_api_url) ||
      normalizeBaseUrl(settings.room_booking_api_base_url) ||
      DEFAULT_PUBLIC_BOOKING_CONFIG.baseUrl;

    return { baseUrl: baseUrl };
  }

  window.DigifyBookingConfig = {
    getConfig: getConfig
  };
})();
