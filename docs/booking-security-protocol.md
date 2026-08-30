# Booking signed-client protocol (v1)

This document is the frontend/backend interoperability contract for the Zendesk room-booking client. The browser never receives the permanent or master API credential. HTTPS/TLS supplies transport encryption; this protocol supplies short-lived request integrity and signed-response validation.

The Apps Script backend and Zendesk frontend must be deployed in the sequence documented below. Until automatic `session_init`, signed request verification, and signed responses are all live, the booking UI fails closed with a friendly retry error.

## Session bootstrap

`action=session_init` is the only unsigned API action the frontend permits. The booking page calls it automatically through the existing JSONP transport before the first business request and whenever the current session expires. It requires no popup, click, Google sign-in, origin handshake, or Help Center user verification.

1. The Zendesk page loads and calls `jsonpRaw("session_init", {})`.
2. The Apps Script deployment uses `access: "ANYONE_ANONYMOUS"` and `executeAs: "USER_DEPLOYING"`.
3. Script A generates a server request id and calls `bookingHandleSessionInit_(requestId)`.
4. The server derives a temporary session id and key from the server-only master secret and returns the unsigned JSON/JSONP bootstrap response.
5. The client validates the bootstrap shape, imports the temporary key as a non-extractable Web Crypto HMAC key, and retains the session only in JavaScript memory.
6. The client signs the pending business request and verifies its signed response before rendering booking data.

The Script Properties required by this boundary are:

```text
BOOKING_MASTER_SECRET=<server-only random value created by initializeBookingSecurity>
```

A successful unsigned bootstrap response is:

```json
{
  "success": true,
  "data": {
    "session_id": "short-lived-session-id",
    "session_key": "short-lived-session-key",
    "expires_at": 1234567890000,
    "server_time": 1234567890000,
    "security_version": "v1"
  }
}
```

All times are Unix milliseconds. `expires_at` must be later than `server_time`. The session key is interpreted as UTF-8 bytes when importing the HMAC key. It must be random, temporary, and scoped to the returned session. The frontend imports it as a non-extractable Web Crypto key and retains the session only in JavaScript memory.

The client uses `server_time - browser_time` as a clock offset, refreshes five seconds before expiry, and shares one in-flight bootstrap Promise across concurrent callers. The session key is never persisted in HTML, cookies, `localStorage`, or `sessionStorage`.

### Deliberate trust boundary

Zendesk login, IT approval, tags, segments, and page permissions remain the only end-user authorization layer. Apps Script does not validate the requester's role, organization, email domain, segment, or approval status. Because the web app is anonymously reachable and `session_init` performs no end-user authentication, this design removes permanent browser credentials and protects request integrity, but it does not make the public Apps Script endpoint an authorization boundary. The public URL and browser requests remain visible in developer tools by design.

## Request business-parameter canonicalization

`BookingSecurity.signRequest(action, params)` applies these steps exactly:

1. Start with the supplied business-parameter object. The action is supplied separately.
2. Remove top-level keys whose value is `undefined` or `null`.
3. Remove these reserved security/transport keys if supplied: `action`, `callback`, `_ts`, `security`, `security_version`, `session_id`, `timestamp`, `nonce`, `payload_hash`, and `signature`.
4. Convert scalar values with JavaScript `String(value)`.
5. Convert arrays to canonical JSON: preserve array order; recursively sort object keys lexicographically; encode strings/booleans/finite numbers/null as JSON; encode unsupported array entries and non-finite numbers as `null`.
6. Convert object values to the same canonical JSON form. Object properties with `undefined`, function, or symbol values are omitted. BigInt is rejected.
7. Sort top-level parameter keys lexicographically using JavaScript's default UTF-16 ordering.
8. Encode each key and converted value with RFC 3986 percent encoding: JavaScript `encodeURIComponent`, plus percent-encoding for `!`, `'`, `(`, `)`, and `*`. Hex digits in percent escapes are uppercase and spaces are `%20`.
9. Join each `encoded_key=encoded_value` pair with `&`, with no leading/trailing delimiter.

Example shape (illustrative values only):

```text
attendee_emails=person%40example.com&dept=Training%20Room%201&repeat_days=0
```

For normal signed business actions, the JSONP `callback` and `_ts` cache-buster are appended by the transport only after signing and are not included in the business payload hash. The unsigned `session_init` transport also uses them solely for JSONP delivery and cache busting.

## Request signature

Calculate the lowercase hexadecimal SHA-256 digest:

```text
payload_hash = SHA256(canonical_business_parameters)
```

Generate a 16-byte nonce with `crypto.getRandomValues()` and encode it as 32 lowercase hexadecimal characters. Generate the server-adjusted current Unix timestamp in milliseconds.

Build this exact UTF-8 string, with a single line-feed (`\n`, U+000A) between fields and no trailing newline:

```text
v1
<action>
<timestamp>
<nonce>
<session_id>
<payload_hash>
```

Calculate lowercase hexadecimal HMAC-SHA256 using the UTF-8 session key. Add these fields to the request alongside the existing business parameters:

```text
security_version=v1
session_id=<session id>
timestamp=<timestamp>
nonce=<nonce>
payload_hash=<sha256>
signature=<hmac-sha256>
```

Apps Script must independently rebuild the canonical business parameters after excluding action, transport, and security fields; reject mismatched hashes; enforce timestamp/session expiry; reject nonce replay; rebuild the exact string-to-sign; and validate the HMAC before executing an action.

## Signed response canonicalization

Every response to a normal business action, including error responses, must contain a top-level `security` object. The frontend rejects malformed, unsigned, stale, expired-session, or invalid responses before using any returned data.

To calculate `body_hash`:

1. Copy the top-level response object while excluding only the top-level `security` property.
2. Serialize as canonical JSON with no whitespace.
3. For every object at every depth, sort keys lexicographically using JavaScript's default UTF-16 ordering.
4. Preserve array order.
5. Serialize strings, booleans, finite numbers, and null using JSON rules. Serialize non-finite numbers as `null`; omit unsupported object properties; serialize unsupported array entries as `null`; reject BigInt.
6. Calculate SHA-256 over the UTF-8 canonical JSON and encode as lowercase hexadecimal.

## Response signature and validation

The response must include:

```json
{
  "security": {
    "version": "v1",
    "session_id": "short-lived-session-id",
    "timestamp": 1234567890000,
    "nonce": "response-nonce",
    "body_hash": "lowercase-sha256-hex",
    "signature": "lowercase-hmac-sha256-hex"
  }
}
```

Build the exact response string-to-sign as UTF-8, with one line-feed between fields and no trailing newline:

```text
v1
response
<timestamp>
<nonce>
<session_id>
<body_hash>
```

The frontend validates in this order:

1. Require a currently usable in-memory session and well-formed security metadata.
2. Require `version` to equal `v1` and `session_id` to equal the active session.
3. Require the response timestamp to be within five minutes of the server-adjusted current time.
4. Canonicalize the body excluding the top-level `security` property, calculate SHA-256, and compare it with `body_hash`.
5. Calculate HMAC-SHA256 over the exact response string-to-sign and compare it with `signature`.
6. Only after successful verification may UI/API error handling inspect or display returned booking data.

Any session/signature failure clears the session and retries once through a fresh `session_init`. Any hash/signature/malformed-response failure clears the session and fails closed without displaying unverified data.

## Deployment and verification order

Do not publish the Zendesk frontend before the matching Apps Script deployment is ready.

1. Keep `BOOKING_MASTER_SECRET`, `ZD_TOKEN`, and every other permanent credential in Apps Script Script Properties only; never copy them into Zendesk or GitHub. `BOOKING_ALLOWED_ORIGINS` is no longer required by this transport.
2. Copy the repository `apps_scripts/script0.json` content into the Apps Script file named `appsscript.json`, and copy the updated `scriptA.gs`. Leave the existing Script B/C business integrations intact.
3. Run `initializeBookingSecurity()`, then `verifyBookingSecurityConfiguration()` and `selfTestBookingSecurityProtocol()` from the editor. Confirm the master secret is configured, the legacy key is revoked, and no secret is returned by diagnostics.
4. Create a new version of the existing Apps Script web-app deployment with `ANYONE_ANONYMOUS` access and execution as the deploying user. Retain the current `/exec` URL.
5. In an unpublished Zendesk theme preview, open the booking page and confirm `session_init` runs automatically as JSONP, followed immediately by a signed `sessions` request and a verified signed response. No popup or user action should occur.
6. Confirm the temporary session appears only in the bootstrap network response and JavaScript memory; no permanent credential appears in source, storage, cookies, URLs, or logs.
7. Test availability, room switching, repeat bookings, booking submission, requester details, cancellation, Calendar/Meet creation, image primaries/fallbacks, and automatic expiry refresh before production publication.
