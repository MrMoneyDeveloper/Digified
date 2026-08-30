# Booking signed-client protocol (v1)

This document is the frontend/backend interoperability contract for the Zendesk room-booking client. The browser never receives the permanent or master API credential. HTTPS/TLS supplies transport encryption; this protocol supplies short-lived request integrity and signed-response validation.

The Apps Script backend and Zendesk frontend must be deployed in the sequence documented below. Until the `session_init` popup, signed request verification, and signed responses are all live, the booking UI fails closed with a friendly secure-session error.

## Session bootstrap

`action=session_init` is the only unsigned API action the frontend permits. It is **not** a JSON or JSONP endpoint and it must never return a session key through a script tag. It is a top-level Apps Script popup with this flow:

1. The Zendesk page generates a cryptographically random 16-byte request id, encoded as 32 lowercase hexadecimal characters.
2. A direct user action opens the Apps Script `/exec` URL in a popup with only `action=session_init`, the exact `window.location.origin`, and the request id in the query string. No key, token, signature, or user data is placed in the URL.
3. The Apps Script deployment uses `access: "ANYONE_ANONYMOUS"` and `executeAs: "USER_DEPLOYING"`. The deploying Gmail account is the backend execution identity; Apps Script does not authenticate or authorize the Help Center user.
4. Script A normalizes the requested origin as an exact HTTPS origin and verifies it against the `BOOKING_ALLOWED_ORIGINS` Script Property. Wildcards are not supported.
5. The HTML-service shell calls `completeBookingSessionInitPopup(requestId, targetOrigin)` asynchronously with `google.script.run`. The shell HTML itself contains no session key.
6. The server repeats the origin and request-id checks, creates the temporary session, and returns it to the HTML-service runtime.
7. The popup calls `window.top.opener.postMessage(message, exactAllowedOrigin)` (falling back to `window.opener` only when appropriate). It never uses `"*"` as `targetOrigin`, clears its temporary key reference after posting, and closes.
8. Zendesk accepts the message only when its type and request id match the outstanding bootstrap, `event.origin` is the Apps Script deployment origin or an HTTPS Apps Script `script.googleusercontent.com` origin, and `event.source` is the opened popup or its HTML-service frame.

The Script Properties required by this boundary are:

```text
BOOKING_MASTER_SECRET=<server-only random value created by initializeBookingSecurity>
BOOKING_ALLOWED_ORIGINS=<comma-separated exact HTTPS Zendesk origins>
```

For this Help Center, the production origin value is expected to be `https://cxe-internal.zendesk.com` unless a custom Help Center domain is the actual value of `window.location.origin`. Do not add a path or trailing slash.

The popup message envelope is:

A successful response is:

```json
{
  "type": "digify.booking.session.v1",
  "request_id": "32-lowercase-hex-characters",
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

For normal signed business actions, the JSONP `callback` and `_ts` cache-buster are appended by the transport only after signing and are not included in the business payload hash. They are never used for `session_init`.

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

1. In the Apps Script project, set the exact `BOOKING_ALLOWED_ORIGINS` value in Script Properties. Keep `BOOKING_MASTER_SECRET`, `ZD_TOKEN`, and every other permanent credential there only; never copy them into Zendesk or GitHub.
2. Copy the repository `apps_scripts/script0.json` content into the Apps Script file named `appsscript.json`, and copy the updated `scriptA.gs`. Leave the existing Script B/C business integrations intact.
3. Run `initializeBookingSecurity()`, then `verifyBookingSecurityConfiguration()` and `selfTestBookingSecurityProtocol()` from the editor. Confirm the exact origin is configured and no secret is returned.
4. Create a new Apps Script web-app deployment/version with `ANYONE_ANONYMOUS` access and execution as the deploying user.
5. Test the deployment through Zendesk's **Connect securely** action. No Google Workspace sign-in is required. A bare `/exec?action=session_init` URL is intentionally incomplete because it lacks the allowlisted origin and random request id.
6. In browser developer tools, confirm `session_init` is a popup navigation, not a JSONP script request; the URL contains no session key; the message target is the exact Zendesk origin; and normal `sessions`, `days`, and `book` requests remain signed JSONP.
7. Only after popup bootstrap and signed availability responses pass, upload the matching Zendesk theme package. Test availability, repeat bookings, booking submission, requester details, cancellation, Calendar/Meet creation, images/fallbacks, expiry refresh, popup cancellation, and popup blocking before production publication.
