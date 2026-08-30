"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BookingSessionPopup = require("../assets/booking-session-popup.js");

const BASE_URL = "https://script.google.com/macros/s/test-deployment/exec";
const ZENDESK_ORIGIN = "https://cxe-internal.zendesk.com";

function fakeCrypto() {
  let seed = 0;
  return {
    getRandomValues(bytes) {
      seed += 1;
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (seed + index) & 0xff;
      }
      return bytes;
    }
  };
}

function fakeBrowser(popupOverride) {
  const listeners = new Map();
  const popup = popupOverride === undefined
    ? { closed: false, frames: [], focus() {} }
    : popupOverride;
  const opened = [];

  const windowRef = {
    location: { origin: ZENDESK_ORIGIN },
    crypto: fakeCrypto(),
    open(url, name, features) {
      opened.push({ url, name, features });
      return popup;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 2;
    },
    clearInterval() {}
  };

  return {
    windowRef,
    popup,
    opened,
    emitMessage(event) {
      const listener = listeners.get("message");
      assert.ok(listener, "message listener must be installed");
      listener(event);
    },
    hasMessageListener() {
      return listeners.has("message");
    }
  };
}

async function run() {
  const cryptoProvider = fakeCrypto();
  const requestId1 = BookingSessionPopup.generateRequestId(cryptoProvider);
  const requestId2 = BookingSessionPopup.generateRequestId(cryptoProvider);
  assert.match(requestId1, /^[a-f0-9]{32}$/);
  assert.notEqual(requestId1, requestId2, "bootstrap request ids must not repeat");

  const popupUrl = BookingSessionPopup.buildPopupUrl(
    BASE_URL,
    ZENDESK_ORIGIN,
    requestId1
  );
  const parsedUrl = new URL(popupUrl);
  assert.equal(parsedUrl.searchParams.get("action"), "session_init");
  assert.equal(parsedUrl.searchParams.get("origin"), ZENDESK_ORIGIN);
  assert.equal(parsedUrl.searchParams.get("request_id"), requestId1);
  assert.equal(parsedUrl.searchParams.has("callback"), false);
  assert.equal(parsedUrl.searchParams.has("session_key"), false);

  assert.equal(
    BookingSessionPopup.isTrustedMessageOrigin("https://script.google.com", BASE_URL),
    true
  );
  assert.equal(
    BookingSessionPopup.isTrustedMessageOrigin(
      "https://abc-script.googleusercontent.com",
      BASE_URL
    ),
    true
  );
  assert.equal(
    BookingSessionPopup.isTrustedMessageOrigin("https://attacker.example", BASE_URL),
    false
  );
  assert.equal(
    BookingSessionPopup.isTrustedMessageOrigin("http://script.google.com", BASE_URL),
    false
  );

  const browser = fakeBrowser();
  const pending = BookingSessionPopup.openSession({
    baseUrl: BASE_URL,
    windowRef: browser.windowRef,
    cryptoProvider: browser.windowRef.crypto
  });
  assert.equal(browser.opened.length, 1);
  const outstandingId = new URL(browser.opened[0].url).searchParams.get("request_id");
  const sessionData = {
    session_id: "temporary-session",
    session_key: "temporary-session-key",
    expires_at: Date.now() + 60000,
    server_time: Date.now(),
    security_version: "v1"
  };

  browser.emitMessage({
    origin: "https://attacker.example",
    source: browser.popup,
    data: {
      type: BookingSessionPopup.MESSAGE_TYPE,
      request_id: outstandingId,
      success: true,
      data: sessionData
    }
  });
  assert.equal(browser.hasMessageListener(), true, "untrusted origins must be ignored");

  browser.emitMessage({
    origin: "https://abc-script.googleusercontent.com",
    source: {},
    data: {
      type: BookingSessionPopup.MESSAGE_TYPE,
      request_id: outstandingId,
      success: true,
      data: sessionData
    }
  });
  assert.equal(browser.hasMessageListener(), true, "unexpected window sources must be ignored");

  browser.emitMessage({
    origin: "https://abc-script.googleusercontent.com",
    source: browser.popup,
    data: {
      type: BookingSessionPopup.MESSAGE_TYPE,
      request_id: outstandingId,
      success: true,
      data: sessionData
    }
  });
  const response = await pending;
  assert.deepEqual(response, { success: true, data: sessionData });
  assert.equal(browser.hasMessageListener(), false, "listener must be removed after success");

  const childSource = {};
  assert.equal(
    BookingSessionPopup.sourceMatchesPopup(childSource, {
      frames: [childSource]
    }),
    true,
    "Apps Script HTML-service child frames must match their popup"
  );

  const blockedBrowser = fakeBrowser(null);
  await assert.rejects(
    BookingSessionPopup.openSession({
      baseUrl: BASE_URL,
      windowRef: blockedBrowser.windowRef,
      cryptoProvider: blockedBrowser.windowRef.crypto
    }),
    (error) => error && error.code === "SESSION_POPUP_BLOCKED"
  );

  const source = fs.readFileSync(
    path.resolve(__dirname, "../assets/booking-session-popup.js"),
    "utf8"
  );
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(source), false);
  assert.equal(/postMessage\s*\([^,]+,\s*["']\*["']/.test(source), false);

  console.log("booking popup bootstrap tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
