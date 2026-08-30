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

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} must include ${expected}`);
}

function assertExcludes(source, unexpected, label) {
  assert.ok(!source.includes(unexpected), `${label} must not include ${unexpected}`);
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
  bookingIds.forEach((id) => {
    assertIncludes(source, `id="${id}"`, relativePath);
  });

  [
    "data-room-image-training-1",
    "data-room-image-training-2",
    "data-room-image-interview"
  ].forEach((attribute) => assertIncludes(source, attribute, relativePath));

  assert.ok(
    source.includes("data-room-base-url") ||
      source.includes("data-training-base-url"),
    `${relativePath} must preserve its public booking base URL attribute`
  );

  assertIncludes(source, "training-bookings.css", relativePath);
  assertIncludes(source, "training-bookings-calendar.js", relativePath);
  assertExcludes(source, "room-preview-inline.js", relativePath);
});

const trainingTemplate = read("templates/custom_pages/training_booking.hbs");
assertExcludes(trainingTemplate, "<style>", "training booking template");

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
  sha256("assets/training-bookings-calendar.js"),
  "10f960baf27c341fb54da82bff12948225f2d55db4367be3f45bcac297ee0b84",
  "booking client behavior must remain unchanged"
);
assert.strictEqual(
  sha256("assets/booking-config.js"),
  "c62f11b9f1aeba7144d962528cb362bbcc639b4de8d2a3e6dd74c6be2954940c",
  "booking public configuration implementation must remain unchanged"
);

const manifest = JSON.parse(read("manifest.json"));
assert.strictEqual(manifest.version, "2028.1.0", "theme version must be bumped");

console.log("theme contract tests passed");
