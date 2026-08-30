"use strict";

const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function digest(relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest("hex");
}

const clients = [
  "assets/training-bookings-calendar.js",
  "assets/room-bookings-calendar.js",
  "script.js"
];

clients.forEach(function (relativePath) {
  const source = read(relativePath);
  assert.ok(
    source.includes('jsonpRaw("session_init", {})'),
    `${relativePath} must bootstrap automatically through JSONP`
  );
  [
    "BookingSessionPopup",
    "bookingSessionPopup",
    "digifyBookingSession_",
    "Connect securely",
    "Allow popups"
  ].forEach(function (unexpected) {
    assert.ok(!source.includes(unexpected), `${relativePath} must exclude ${unexpected}`);
  });
});

const scriptA = read("apps_scripts/scriptA.gs");
assert.ok(scriptA.includes('if (action === "session_init")'));
assert.ok(scriptA.includes("const result = bookingHandleSessionInit_(requestId);"));
assert.ok(scriptA.includes("return jsonResponse_(result, e);"));
assert.ok(scriptA.includes("SESSION_TTL_MS: 10 * 60 * 1000"));
assert.ok(scriptA.includes("session_key: sessionKey"));

[
  "bookingServeSessionInitPopup_",
  "completeBookingSessionInitPopup",
  "bookingCreateSessionPopupHtml_",
  "BOOKING_ALLOWED_ORIGINS",
  "POPUP_MESSAGE_TYPE",
  "postMessage",
  "HtmlService"
].forEach(function (unexpected) {
  assert.ok(!scriptA.includes(unexpected), `Script A must exclude ${unexpected}`);
});

const documentHead = read("templates/document_head.hbs");
assert.ok(!documentHead.includes("booking-session-popup.js"));
assert.ok(!fs.existsSync(path.join(ROOT, "assets/booking-session-popup.js")));

[
  [
    "assets/room-preview-training-room-1-v3.jpeg",
    "assets/room-preview-training-room-1-fallback-v2.jpeg"
  ],
  [
    "assets/room-preview-training-room-2-v3.jpeg",
    "assets/room-preview-training-room-2-fallback-v2.jpeg"
  ]
].forEach(function ([primary, fallback]) {
  assert.ok(fs.statSync(path.join(ROOT, primary)).size > 0, `${primary} must not be empty`);
  assert.ok(fs.statSync(path.join(ROOT, fallback)).size > 0, `${fallback} must not be empty`);
  assert.notEqual(digest(primary), digest(fallback), `${fallback} must be independent`);
});

console.log("booking automatic bootstrap tests passed");
