(function (root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BookingSecurity = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const VERSION = "v1";
  const DEFAULT_RESPONSE_WINDOW_MS = 5 * 60 * 1000;
  const DEFAULT_REFRESH_LEEWAY_MS = 5 * 1000;
  const SECURITY_FIELDS = {
    action: true,
    callback: true,
    _ts: true,
    security: true,
    security_version: true,
    session_id: true,
    timestamp: true,
    nonce: true,
    payload_hash: true,
    signature: true
  };

  let bootstrap = null;
  let bootstrapPromise = null;
  let session = null;
  let clockOffsetMs = 0;
  let responseWindowMs = DEFAULT_RESPONSE_WINDOW_MS;
  let refreshLeewayMs = DEFAULT_REFRESH_LEEWAY_MS;
  let statusHandler = null;

  function SecurityError(code, message) {
    this.name = "BookingSecurityError";
    this.code = code;
    this.message = message;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SecurityError);
    }
  }
  SecurityError.prototype = Object.create(Error.prototype);
  SecurityError.prototype.constructor = SecurityError;

  function getCrypto() {
    const cryptoApi = root && root.crypto;
    if (
      !cryptoApi ||
      !cryptoApi.subtle ||
      typeof cryptoApi.getRandomValues !== "function"
    ) {
      throw new SecurityError(
        "WEB_CRYPTO_UNAVAILABLE",
        "Secure booking is not supported by this browser."
      );
    }
    return cryptoApi;
  }

  function utf8(value) {
    if (!root || typeof root.TextEncoder !== "function") {
      throw new SecurityError(
        "TEXT_ENCODER_UNAVAILABLE",
        "Secure booking is not supported by this browser."
      );
    }
    return new root.TextEncoder().encode(String(value));
  }

  function bytesToHex(bytes) {
    return Array.prototype.map
      .call(new Uint8Array(bytes), function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, function (character) {
      return "%" + character.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  function canonicalJson(value, inArray) {
    if (value === null) return "null";

    const valueType = typeof value;
    if (valueType === "string" || valueType === "boolean") {
      return JSON.stringify(value);
    }
    if (valueType === "number") {
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    }
    if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
      return inArray ? "null" : undefined;
    }
    if (valueType === "bigint") {
      throw new TypeError("BigInt values are not supported in booking payloads.");
    }
    if (Array.isArray(value)) {
      return (
        "[" +
        value
          .map(function (item) {
            const encoded = canonicalJson(item, true);
            return encoded === undefined ? "null" : encoded;
          })
          .join(",") +
        "]"
      );
    }
    if (value && valueType === "object") {
      const entries = [];
      Object.keys(value)
        .sort()
        .forEach(function (key) {
          const encoded = canonicalJson(value[key], false);
          if (encoded !== undefined) {
            entries.push(JSON.stringify(key) + ":" + encoded);
          }
        });
      return "{" + entries.join(",") + "}";
    }
    return inArray ? "null" : undefined;
  }

  function requestValueToString(value) {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      return canonicalJson(value, false);
    }
    return String(value);
  }

  function normalizeBusinessParameters(params) {
    const normalized = {};
    if (!params || typeof params !== "object") return normalized;

    Object.keys(params).forEach(function (key) {
      const value = params[key];
      if (SECURITY_FIELDS[key] || value === undefined || value === null) return;
      normalized[String(key)] = requestValueToString(value);
    });
    return normalized;
  }

  function canonicalizeBusinessParameters(params) {
    const normalized = normalizeBusinessParameters(params);
    return Object.keys(normalized)
      .sort()
      .map(function (key) {
        return encodeRfc3986(key) + "=" + encodeRfc3986(normalized[key]);
      })
      .join("&");
  }

  function canonicalizeResponseBody(response) {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new TypeError("The booking response body must be an object.");
    }
    const body = {};
    Object.keys(response).forEach(function (key) {
      if (key !== "security") body[key] = response[key];
    });
    return canonicalJson(body, false);
  }

  async function sha256Hex(value) {
    const digest = await getCrypto().subtle.digest("SHA-256", utf8(value));
    return bytesToHex(digest);
  }

  async function importHmacKey(sessionKey) {
    return getCrypto().subtle.importKey(
      "raw",
      utf8(sessionKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }

  async function signWithKey(key, value) {
    const signature = await getCrypto().subtle.sign("HMAC", key, utf8(value));
    return bytesToHex(signature);
  }

  async function hmacSha256Hex(keyValue, value) {
    const key = await importHmacKey(keyValue);
    return signWithKey(key, value);
  }

  function generateNonce() {
    const bytes = new Uint8Array(16);
    getCrypto().getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  function serverNow() {
    return Date.now() + clockOffsetMs;
  }

  function sessionIsUsable() {
    return (
      session &&
      session.version === VERSION &&
      session.expiresAt - refreshLeewayMs > serverNow()
    );
  }

  function publicSessionInfo() {
    return session
      ? {
          session_id: session.id,
          expires_at: session.expiresAt,
          security_version: session.version
        }
      : null;
  }

  function notifyStatus(status) {
    if (typeof statusHandler !== "function") return;
    try {
      statusHandler(status);
    } catch (error) {
      // UI status callbacks must never interrupt security processing.
    }
  }

  function clearSession() {
    session = null;
    clockOffsetMs = 0;
  }

  function init(options) {
    const config = options || {};
    if (typeof config.bootstrap !== "function") {
      throw new TypeError("BookingSecurity.init requires a bootstrap function.");
    }

    clearSession();
    bootstrapPromise = null;
    bootstrap = config.bootstrap;
    responseWindowMs = Number.isFinite(config.responseWindowMs)
      ? Math.max(1000, Number(config.responseWindowMs))
      : DEFAULT_RESPONSE_WINDOW_MS;
    refreshLeewayMs = Number.isFinite(config.refreshLeewayMs)
      ? Math.max(0, Number(config.refreshLeewayMs))
      : DEFAULT_REFRESH_LEEWAY_MS;
    statusHandler = typeof config.onStatus === "function" ? config.onStatus : null;
    return api;
  }

  async function establishSession() {
    try {
      const response = await bootstrap();
      const data = response && response.success === true ? response.data : null;
      const sessionId = data && String(data.session_id || "");
      const sessionKey = data && String(data.session_key || "");
      const expiresAt = data && Number(data.expires_at);
      const serverTime = data && Number(data.server_time);
      const securityVersion = data && String(data.security_version || "");

      if (
        !sessionId ||
        /[\r\n]/.test(sessionId) ||
        !sessionKey ||
        !Number.isFinite(expiresAt) ||
        !Number.isFinite(serverTime) ||
        expiresAt <= serverTime ||
        securityVersion !== VERSION
      ) {
        throw new Error("Invalid session response.");
      }

      const key = await importHmacKey(sessionKey);
      clockOffsetMs = serverTime - Date.now();
      session = {
        id: sessionId,
        key: key,
        expiresAt: expiresAt,
        version: securityVersion
      };

      if (!sessionIsUsable()) {
        clearSession();
        throw new Error("Session expired during bootstrap.");
      }
      return publicSessionInfo();
    } catch (error) {
      clearSession();
      throw new SecurityError(
        "SESSION_INIT_FAILED",
        "Secure booking session could not be established."
      );
    }
  }

  async function ensureSession() {
    if (sessionIsUsable()) return publicSessionInfo();

    if (session) {
      clearSession();
      notifyStatus("session_expired");
    }
    if (!bootstrapPromise) {
      bootstrapPromise = establishSession().finally(function () {
        bootstrapPromise = null;
      });
    }
    return bootstrapPromise;
  }

  function buildRequestStringToSign(action, timestamp, nonce, sessionId, payloadHash) {
    return [VERSION, action, timestamp, nonce, sessionId, payloadHash].join("\n");
  }

  function buildResponseStringToSign(timestamp, nonce, sessionId, bodyHash) {
    return [VERSION, "response", timestamp, nonce, sessionId, bodyHash].join("\n");
  }

  async function signRequest(action, params) {
    const normalizedAction = String(action || "");
    if (!normalizedAction || /[\r\n]/.test(normalizedAction) || normalizedAction === "session_init") {
      throw new SecurityError("INVALID_ACTION", "Secure booking request is invalid.");
    }

    await ensureSession();
    const businessParameters = normalizeBusinessParameters(params);
    const canonicalPayload = canonicalizeBusinessParameters(businessParameters);
    const payloadHash = await sha256Hex(canonicalPayload);
    const timestamp = Math.floor(serverNow());
    const nonce = generateNonce();
    const stringToSign = buildRequestStringToSign(
      normalizedAction,
      timestamp,
      nonce,
      session.id,
      payloadHash
    );
    const signature = await signWithKey(session.key, stringToSign);

    return Object.assign({}, businessParameters, {
      security_version: VERSION,
      session_id: session.id,
      timestamp: String(timestamp),
      nonce: nonce,
      payload_hash: payloadHash,
      signature: signature
    });
  }

  function constantTimeHexEqual(left, right) {
    const a = String(left || "").toLowerCase();
    const b = String(right || "").toLowerCase();
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
      difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return difference === 0;
  }

  function verificationError() {
    clearSession();
    return new SecurityError(
      "RESPONSE_VERIFICATION_FAILED",
      "Unable to verify the booking service response. Please retry."
    );
  }

  async function verifyResponse(response) {
    try {
      if (!sessionIsUsable()) throw new Error("No active session.");
      if (!response || typeof response !== "object" || Array.isArray(response)) {
        throw new Error("Malformed response.");
      }

      const security = response.security;
      if (!security || typeof security !== "object" || Array.isArray(security)) {
        throw new Error("Unsigned response.");
      }

      const version = String(security.version || "");
      const sessionId = String(security.session_id || "");
      const timestamp = Number(security.timestamp);
      const timestampText = String(security.timestamp || "");
      const nonce = String(security.nonce || "");
      const bodyHash = String(security.body_hash || "").toLowerCase();
      const signature = String(security.signature || "").toLowerCase();

      if (
        version !== VERSION ||
        sessionId !== session.id ||
        !Number.isFinite(timestamp) ||
        !/^\d+$/.test(timestampText) ||
        !nonce ||
        /[\r\n]/.test(nonce) ||
        !/^[0-9a-f]{64}$/.test(bodyHash) ||
        !/^[0-9a-f]{64}$/.test(signature) ||
        Math.abs(serverNow() - timestamp) > responseWindowMs
      ) {
        throw new Error("Invalid response security metadata.");
      }

      const calculatedBodyHash = await sha256Hex(canonicalizeResponseBody(response));
      if (!constantTimeHexEqual(calculatedBodyHash, bodyHash)) {
        throw new Error("Response body hash mismatch.");
      }

      const stringToSign = buildResponseStringToSign(
        timestampText,
        nonce,
        sessionId,
        bodyHash
      );
      const expectedSignature = await signWithKey(session.key, stringToSign);
      if (!constantTimeHexEqual(expectedSignature, signature)) {
        throw new Error("Response signature mismatch.");
      }
      return true;
    } catch (error) {
      throw verificationError();
    }
  }

  function isAuthenticationFailure(response) {
    if (!response || typeof response !== "object") return false;
    const statusCode = Number(response.statusCode);
    if (statusCode === 401 || statusCode === 403) return true;
    const code = String(response.code || "").toUpperCase();
    return /(?:AUTH|UNAUTHORIZED|SESSION|SIGNATURE|NONCE|REPLAY|SECURITY)/.test(code);
  }

  async function request(action, params, transport, retryCount) {
    if (typeof transport !== "function") {
      throw new TypeError("A booking request transport function is required.");
    }

    const signedParams = await signRequest(action, params || {});
    const response = await transport(action, signedParams);
    await verifyResponse(response);

    if (isAuthenticationFailure(response)) {
      clearSession();
      if (!retryCount) {
        notifyStatus("session_expired");
        await ensureSession();
        return request(action, params, transport, 1);
      }
      throw new SecurityError(
        "SESSION_AUTH_FAILED",
        "Secure booking session could not be established."
      );
    }
    return response;
  }

  const api = {
    init: init,
    ensureSession: ensureSession,
    signRequest: signRequest,
    verifyResponse: verifyResponse,
    clearSession: clearSession,
    request: request,
    isAuthenticationFailure: isAuthenticationFailure,
    canonicalizeBusinessParameters: canonicalizeBusinessParameters,
    canonicalizeResponseBody: canonicalizeResponseBody,
    sha256Hex: sha256Hex,
    hmacSha256Hex: hmacSha256Hex,
    generateNonce: generateNonce,
    buildRequestStringToSign: buildRequestStringToSign,
    buildResponseStringToSign: buildResponseStringToSign
  };

  return api;
});
