"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest("hex");
}

function sha256NormalizedText(relativePath) {
  return crypto
    .createHash("sha256")
    .update(read(relativePath).replace(/\r\n/g, "\n"))
    .digest("hex");
}

function gitBlobSha1(relativePath) {
  const content = Buffer.from(read(relativePath).replace(/\r\n/g, "\n"));
  return crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`))
    .update(content)
    .digest("hex");
}

function scriptAConfigValue(source, name) {
  const match = source.match(new RegExp(`${name}: "([^"]+)"`));
  assert.ok(match, `Script A must declare ${name}`);
  return match[1];
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} must include ${expected}`);
}

function assertExcludes(source, unexpected, label) {
  assert.ok(!source.includes(unexpected), `${label} must not include ${unexpected}`);
}

function assertModalOutsideBookingRoot(source, label) {
  const tags = source.match(/<div\b[^>]*>|<\/div>/gi) || [];
  let depth = 0;
  let rootDepth = null;
  let modalSeen = false;

  tags.forEach((tag) => {
    if (/^<\/div/i.test(tag)) {
      if (rootDepth === depth) rootDepth = null;
      depth -= 1;
      return;
    }

    depth += 1;
    if (/id="training-booking-root"/i.test(tag)) rootDepth = depth;
    if (/id="training-booking-modal"/i.test(tag)) {
      modalSeen = true;
      assert.strictEqual(
        rootDepth,
        null,
        `${label} modal must remain outside the container-query booking root`
      );
    }
  });

  assert.ok(modalSeen, `${label} must include the booking modal`);
}

const bookingTemplates = [
  "templates/custom_pages/room_booking.hbs",
  "templates/custom_pages/training_booking.hbs"
];

const bookingIds = [
  "training-booking-root",
  "training-booking-alert",
  "training-booking-filters",
  "training-date",
  "training-room",
  "training-repeat-days",
  "training-load",
  "training-reset",
  "training-room-preview",
  "training-room-preview-image",
  "training-room-preview-placeholder",
  "training-room-preview-title",
  "training-room-preview-caption",
  "training-booking-loading",
  "training-booking-selection",
  "training-booking-list",
  "training-booking-modal",
  "training-booking-form",
  "training-booking-requester-name",
  "training-booking-requester-email",
  "training-booking-notes",
  "training-booking-online",
  "training-booking-attendees",
  "training-booking-add-attendee",
  "training-booking-submit",
  "training-booking-modal-cancel"
];

bookingTemplates.forEach((relativePath) => {
  const source = read(relativePath);
  assertModalOutsideBookingRoot(source, relativePath);
  bookingIds.forEach((id) => {
    assertIncludes(source, `id="${id}"`, relativePath);
  });

  [
    "data-room-image-training-1",
    "data-room-image-training-1-fallback",
    "data-room-image-training-2",
    "data-room-image-training-2-fallback",
    "data-room-image-interview"
  ].forEach((attribute) => assertIncludes(source, attribute, relativePath));

  ["training-1", "training-2"].forEach((roomKey) => {
    const primary = source.match(
      new RegExp(`data-room-image-${roomKey}="\\{\\{asset '([^']+)'\\}\\}"`)
    );
    const fallback = source.match(
      new RegExp(`data-room-image-${roomKey}-fallback="\\{\\{asset '([^']+)'\\}\\}"`)
    );
    assert.ok(primary && fallback, `${relativePath} must declare ${roomKey} image assets`);
    assert.notEqual(
      primary[1],
      fallback[1],
      `${relativePath} ${roomKey} fallback must use an independent asset URL`
    );
    assert.ok(fs.existsSync(path.join(ROOT, "assets", primary[1])));
    assert.ok(fs.existsSync(path.join(ROOT, "assets", fallback[1])));
  });

  assert.ok(
    source.includes("data-room-base-url") ||
      source.includes("data-training-base-url"),
    `${relativePath} must preserve its public booking base URL attribute`
  );

  assertIncludes(source, "training-bookings.css", relativePath);
  assertIncludes(source, "training-bookings-calendar.js", relativePath);
  assertIncludes(source, 'loading="eager"', relativePath);
  assertIncludes(source, 'fetchpriority="high"', relativePath);
  assertExcludes(source, "room-preview-inline.js", relativePath);
});

const trainingTemplate = read("templates/custom_pages/training_booking.hbs");
assertExcludes(trainingTemplate, "<style>", "training booking template");

const bookingStyles = read("assets/training-bookings.css");
assert.ok(
  /\.tb-modal\s*\{\s*position:\s*fixed;/.test(bookingStyles),
  "booking modal styles must keep the overlay fixed to the viewport"
);
assertIncludes(bookingStyles, "min-height: 100dvh;", "booking modal styles");
assertIncludes(bookingStyles, "overscroll-behavior: contain;", "booking modal styles");

const bookingHarness = read("tests/booking-ui-harness.html");
bookingIds.forEach((id) => assertIncludes(bookingHarness, `id="${id}"`, "booking harness"));
assertExcludes(bookingHarness, "booking-security.js", "non-production booking harness");

const documentHead = read("templates/document_head.hbs");
[
  "bootstrap.min.css",
  "booking-config.js",
  "booking-security.js",
  "theme-ui.js",
  "alpine-csp.min.js",
  "gsap.min.js",
  "theme-motion.js"
].forEach((asset) => assertIncludes(documentHead, asset, "document head"));

const themeUiHarness = read("tests/theme-ui-harness.html");
assertIncludes(themeUiHarness, "x-data=\"digifyHeader\"", "theme UI harness");
assertIncludes(themeUiHarness, "data-digify-motion=\"hero\"", "theme UI harness");
assertIncludes(themeUiHarness, "access-hub-card-internal", "theme UI harness");
assertIncludes(themeUiHarness, "landing-card--staff", "theme UI harness");
assertIncludes(themeUiHarness, "policy-card-grid", "theme UI harness");

const header = read("templates/header.hbs");
assertIncludes(header, "digify_intro_seen_v1", "header intro");
assertIncludes(header, "x-data=\"digifyHeader\"", "header Alpine component");
assertExcludes(header, "digify-cx-looped-loader.mp4", "header");

const style = read("style.css");
assertIncludes(style, "container-type: inline-size", "theme stylesheet");
assertIncludes(style, "@container", "theme stylesheet");
assertIncludes(style, "@media (min-width: 40rem)", "theme stylesheet");
assertIncludes(style, "@media (prefers-reduced-motion: reduce)", "theme stylesheet");
assertIncludes(style, "[data-digify-motion]", "theme stylesheet");
assertIncludes(style, ".policies-page .policy-card-grid > .row > .col", "theme stylesheet");
assertIncludes(style, ".access-hub-cards .access-hub-card-internal", "theme stylesheet");
assertIncludes(style, ".signup-options-section .landing-card .btn.btn-primary", "theme stylesheet");

const bookingClient = read("assets/training-bookings-calendar.js");
assertIncludes(bookingClient, "const probe = new Image()", "booking room preview loader");
assertIncludes(bookingClient, "previewRequestId", "booking room preview loader");
assertExcludes(bookingClient, "swapPreviewExtension", "booking room preview loader");
[
  "data-room-image-training-1",
  "data-room-image-training-1-fallback",
  "data-room-image-training-2",
  "data-room-image-training-2-fallback",
  "data-room-image-interview",
  "data-room-image-interview-fallback"
].forEach((attribute) => {
  assertIncludes(
    bookingClient,
    `readPreviewAsset("${attribute}")`,
    "booking room preview attribute mapping"
  );
});
assertExcludes(
  bookingClient,
  "root.dataset.roomImageTraining",
  "booking room preview attribute mapping"
);
assertIncludes(bookingClient, 'jsonpRaw("session_init", {})', "automatic bootstrap integration");
assertExcludes(bookingClient, "BookingSessionPopup", "automatic bootstrap integration");
assertExcludes(bookingClient, "Connect securely", "automatic bootstrap integration");

const legacyBookingClient = read("assets/room-bookings-calendar.js");
assertIncludes(legacyBookingClient, 'jsonpRaw("session_init", {})', "legacy automatic bootstrap integration");
assertExcludes(legacyBookingClient, "BookingSessionPopup", "legacy automatic bootstrap integration");

const appsScriptManifest = JSON.parse(read("apps_scripts/script0.json"));
assert.strictEqual(appsScriptManifest.webapp.access, "ANYONE_ANONYMOUS");
assert.strictEqual(appsScriptManifest.webapp.executeAs, "USER_DEPLOYING");
assert.ok(!appsScriptManifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"));

const scriptA = read("apps_scripts/scriptA.gs");
assertIncludes(scriptA, 'if (action === "session_init")', "Script A");
assertIncludes(scriptA, "const result = bookingHandleSessionInit_(requestId);", "Script A");
assertIncludes(scriptA, "return jsonResponse_(result, e);", "Script A");
assertExcludes(scriptA, "bookingServeSessionInitPopup_", "Script A");
assertExcludes(scriptA, "completeBookingSessionInitPopup", "Script A");
assertExcludes(scriptA, "BOOKING_ALLOWED_ORIGINS", "Script A");
assertExcludes(scriptA, "postMessage", "Script A");
assertExcludes(scriptA, "BOOKING_ALLOWED_DOMAINS", "Script A");
assertExcludes(scriptA, "Session.getActiveUser()", "Script A");
assertExcludes(scriptA, "bookingAuthorizeSessionInit_", "Script A");
assertExcludes(scriptA, "REQUESTER_IDENTITY_MISMATCH", "Script A");
assert.strictEqual(
  scriptAConfigValue(scriptA, "FRONTEND_PROTOCOL_DOC_SHA"),
  gitBlobSha1("docs/booking-security-protocol.md")
);
assert.strictEqual(
  scriptAConfigValue(scriptA, "FRONTEND_SECURITY_JS_SHA"),
  sha256("assets/booking-security.js")
);
assert.strictEqual(
  scriptAConfigValue(scriptA, "FRONTEND_BOOKING_CLIENT_SHA"),
  sha256NormalizedText("assets/training-bookings-calendar.js")
);
assert.strictEqual(
  scriptAConfigValue(scriptA, "FRONTEND_LEGACY_BOOKING_CLIENT_SHA"),
  sha256NormalizedText("assets/room-bookings-calendar.js")
);
assert.strictEqual(
  scriptAConfigValue(scriptA, "FRONTEND_THEME_SCRIPT_SHA"),
  sha256NormalizedText("script.js")
);
assert.strictEqual(
  scriptAConfigValue(scriptA, "FRONTEND_CONFIG_JS_SHA"),
  sha256("assets/booking-config.js")
);

const runtimeSources = [
  documentHead,
  header,
  read("script.js"),
  ...bookingTemplates.map(read)
].join("\n");

[
  "htmx",
  "lozad",
  "workbox",
  "lenis",
  "date-fns",
  "tailwindcss"
].forEach((dependency) =>
  assertExcludes(runtimeSources.toLowerCase(), dependency, "runtime sources")
);

assert.strictEqual(
  sha256("assets/booking-security.js"),
  "b58d62a4f49f25b843bd0899bbca98edfaf84bcdaf0224a5d5c71cc1ee7aec90",
  "booking security implementation must remain unchanged"
);
assert.strictEqual(
  sha256NormalizedText("assets/training-bookings-calendar.js"),
  "52f4d2d9abe4355ed698216937058952211aa68565c8a075eb541f0d19e51211",
  "booking client behavior must match the automatic bootstrap/fallback baseline"
);
assert.strictEqual(
  sha256NormalizedText("assets/room-bookings-calendar.js"),
  "205e2d88a5183a35489fd88749af5a4eb5e2b817a53a048e328e9678f40f221d",
  "legacy booking client must use the same automatic bootstrap contract"
);
assert.strictEqual(
  sha256("assets/booking-config.js"),
  "c62f11b9f1aeba7144d962528cb362bbcc639b4de8d2a3e6dd74c6be2954940c",
  "booking public configuration implementation must remain unchanged"
);

const manifest = JSON.parse(read("manifest.json"));
assert.strictEqual(manifest.version, "2028.2.8", "theme version must be bumped");

console.log("theme contract tests passed");
