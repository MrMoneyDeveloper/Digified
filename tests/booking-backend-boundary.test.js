"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} must include ${expected}`);
}

function assertExcludes(source, unexpected, label) {
  assert.ok(!source.includes(unexpected), `${label} must not include ${unexpected}`);
}

const manifest = JSON.parse(read("apps_scripts/script0.json"));
const scriptA = read("apps_scripts/scriptA.gs");
const popup = read("assets/booking-session-popup.js");
const protocol = read("docs/booking-security-protocol.md");

assert.strictEqual(manifest.webapp.executeAs, "USER_DEPLOYING");
assert.strictEqual(manifest.webapp.access, "ANYONE_ANONYMOUS");
assert.ok(!manifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"));

[
  "BOOKING_ALLOWED_DOMAINS",
  "Session.getActiveUser()",
  "bookingAuthorizeSessionInit_",
  "REQUESTER_IDENTITY_MISMATCH",
  "CANCEL_NOT_AUTHORIZED"
].forEach((value) => assertExcludes(scriptA, value, "Script A"));

assertIncludes(scriptA, 'MASTER_SECRET_PROP: "BOOKING_MASTER_SECRET"', "Script A");
assertIncludes(scriptA, 'ALLOWED_ORIGINS_PROP: "BOOKING_ALLOWED_ORIGINS"', "Script A");
assertIncludes(scriptA, 'scope: "booking"', "Script A session token");
assertIncludes(scriptA, "bookingVerifySignedRequest_", "Script A signed requests");
assertIncludes(scriptA, "bookingSignResponse_", "Script A signed responses");
assertIncludes(scriptA, "bookingReserveNonce_", "Script A replay protection");
assertIncludes(scriptA, "handleCancel_(body, requestId)", "Script A cancellation flow");
assertExcludes(scriptA, "api_key: apiKey", "Script A public response");
assertExcludes(scriptA, "handleGetApiKey_", "Script A");

assertIncludes(popup, "sourceMatchesPopup(event.source, popup)", "popup client");
assertIncludes(popup, "isTrustedMessageOrigin(event.origin", "popup client");
assertExcludes(popup, 'postMessage(message, "*")', "popup client");
assertExcludes(popup, "localStorage", "popup client");
assertExcludes(popup, "sessionStorage", "popup client");

assertIncludes(protocol, "Zendesk login, IT approval, tags, segments", "protocol trust boundary");
assertIncludes(protocol, 'access: "ANYONE_ANONYMOUS"', "protocol deployment contract");
assertExcludes(protocol, "BOOKING_ALLOWED_DOMAINS", "protocol");
assertExcludes(protocol, "Session.getActiveUser()", "protocol");

const browserFiles = [
  "assets/booking-config.js",
  "assets/booking-security.js",
  "assets/booking-session-popup.js",
  "assets/room-bookings-calendar.js",
  "assets/training-bookings-calendar.js",
  "templates/custom_pages/room_booking.hbs",
  "templates/custom_pages/training_booking.hbs",
  "settings_schema.json"
];
const browserSource = browserFiles.map(read).join("\n");

[
  /\bapiKey\b/i,
  /\bapi_key\b/i,
  /training_api_key/i,
  /room_booking_api_key/i,
  /data-training-api-key/i,
  /data-room-api-key/i,
  /FALLBACK_BOOKING_CONFIG/,
  /HARDCODED_API_KEY/,
  /get_api_key/i
].forEach((pattern) => {
  assert.ok(!pattern.test(browserSource), `browser-delivered files must exclude ${pattern}`);
});

console.log("Booking backend trust-boundary contract tests passed.");
