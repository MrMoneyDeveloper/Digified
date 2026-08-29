"use strict";

const assert = require("node:assert/strict");
const BookingSecurity = require("../assets/booking-security.js");

const TEST_SESSION_KEY = "temporary-test-session-key";

function sessionResponse(overrides) {
  const now = Date.now();
  return {
    success: true,
    data: Object.assign(
      {
        session_id: "test-session",
        session_key: TEST_SESSION_KEY,
        expires_at: now + 60_000,
        server_time: now,
        security_version: "v1"
      },
      overrides || {}
    )
  };
}

async function signedResponse(body, options) {
  const response = Object.assign({}, body);
  const timestamp = String((options && options.timestamp) || Date.now());
  const nonce = (options && options.nonce) || "00112233445566778899aabbccddeeff";
  const sessionId = (options && options.sessionId) || "test-session";
  const bodyHash = await BookingSecurity.sha256Hex(
    BookingSecurity.canonicalizeResponseBody(response)
  );
  const stringToSign = BookingSecurity.buildResponseStringToSign(
    timestamp,
    nonce,
    sessionId,
    bodyHash
  );
  response.security = {
    version: "v1",
    session_id: sessionId,
    timestamp: Number(timestamp),
    nonce: nonce,
    body_hash: bodyHash,
    signature: await BookingSecurity.hmacSha256Hex(TEST_SESSION_KEY, stringToSign)
  };
  return response;
}

async function run() {
  const canonical = BookingSecurity.canonicalizeBusinessParameters({
    b: 2,
    a: "hello world",
    arr: ["x", 2, { z: true, a: "first" }],
    nil: null,
    signature: "ignored"
  });
  assert.equal(
    canonical,
    "a=hello%20world&arr=%5B%22x%22%2C2%2C%7B%22a%22%3A%22first%22%2C%22z%22%3Atrue%7D%5D&b=2"
  );
  assert.equal(
    canonical,
    BookingSecurity.canonicalizeBusinessParameters({
      arr: ["x", 2, { a: "first", z: true }],
      a: "hello world",
      b: 2
    })
  );

  assert.equal(
    await BookingSecurity.sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );

  const knownHmac = await BookingSecurity.hmacSha256Hex(
    "key",
    "The quick brown fox jumps over the lazy dog"
  );
  assert.equal(
    knownHmac,
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
  );
  assert.equal(
    knownHmac,
    await BookingSecurity.hmacSha256Hex(
      "key",
      "The quick brown fox jumps over the lazy dog"
    )
  );

  const originalHash = await BookingSecurity.sha256Hex("a=1");
  const alteredHash = await BookingSecurity.sha256Hex("a=2");
  assert.notEqual(originalHash, alteredHash);
  assert.notEqual(
    await BookingSecurity.hmacSha256Hex("key", originalHash),
    await BookingSecurity.hmacSha256Hex("key", alteredHash)
  );

  BookingSecurity.init({ bootstrap: async function () { return sessionResponse(); } });
  await BookingSecurity.ensureSession();
  const signedRequest = await BookingSecurity.signRequest("book", { b: 2, a: 1 });
  assert.equal(
    signedRequest.payload_hash,
    await BookingSecurity.sha256Hex("a=1&b=2")
  );
  assert.match(signedRequest.nonce, /^[0-9a-f]{32}$/);
  assert.match(signedRequest.signature, /^[0-9a-f]{64}$/);
  assert.equal(
    signedRequest.signature,
    await BookingSecurity.hmacSha256Hex(
      TEST_SESSION_KEY,
      BookingSecurity.buildRequestStringToSign(
        "book",
        signedRequest.timestamp,
        signedRequest.nonce,
        signedRequest.session_id,
        signedRequest.payload_hash
      )
    )
  );
  await assert.rejects(
    BookingSecurity.signRequest("session_init", {}),
    /Secure booking request is invalid/
  );

  const validResponse = await signedResponse({
    success: true,
    data: { sessions: [{ slot_id: "one", available: true }] }
  });
  assert.equal(await BookingSecurity.verifyResponse(validResponse), true);

  const modifiedResponse = Object.assign({}, validResponse, {
    data: { sessions: [{ slot_id: "one", available: false }] }
  });
  await assert.rejects(
    BookingSecurity.verifyResponse(modifiedResponse),
    /Unable to verify the booking service response/
  );

  BookingSecurity.init({ bootstrap: async function () { return sessionResponse(); } });
  await BookingSecurity.ensureSession();
  await assert.rejects(
    BookingSecurity.verifyResponse({ success: true, data: {} }),
    /Unable to verify the booking service response/
  );

  let bootstrapCount = 0;
  BookingSecurity.init({
    refreshLeewayMs: 0,
    bootstrap: async function () {
      bootstrapCount += 1;
      return sessionResponse({
        session_id: "refresh-session-" + bootstrapCount,
        expires_at: Date.now() + (bootstrapCount === 1 ? 100 : 60_000),
        server_time: Date.now()
      });
    }
  });
  await BookingSecurity.ensureSession();
  await new Promise(function (resolve) { setTimeout(resolve, 125); });
  await BookingSecurity.ensureSession();
  assert.equal(bootstrapCount, 2);

  let concurrentBootstraps = 0;
  BookingSecurity.init({
    bootstrap: async function () {
      concurrentBootstraps += 1;
      await new Promise(function (resolve) { setTimeout(resolve, 15); });
      return sessionResponse();
    }
  });
  await Promise.all([
    BookingSecurity.ensureSession(),
    BookingSecurity.ensureSession(),
    BookingSecurity.ensureSession()
  ]);
  assert.equal(concurrentBootstraps, 1);

  const nonces = new Set();
  for (let index = 0; index < 16; index += 1) {
    nonces.add(BookingSecurity.generateNonce());
  }
  assert.equal(nonces.size, 16);
  assert.ok(Array.from(nonces).every(function (nonce) {
    return /^[0-9a-f]{32}$/.test(nonce);
  }));

  console.log("booking-security tests passed");
}

run().catch(function (error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
