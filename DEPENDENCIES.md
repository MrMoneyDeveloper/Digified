# Digified Guide + Booking — Dependencies and Configuration

Companion to [HANDOVER.md](HANDOVER.md). Based on repository documentation and configuration/source inspected on 7 October 2026; the live deployment must be reconciled before sign-off. Package manifests and lockfiles remain authoritative for exact transitive versions; this is the operational dependency list, not a frozen software bill of materials.

| Dependency | Required setup / configuration | Source or handover action |
| --- | --- | --- |
| Theme/build | Zendesk Guide; Handlebars templates, JavaScript/CSS; PowerShell/tar packaging; Node for contract tests | manifest.json; package-theme.ps1; README; THEME_STRUCTURE.md |
| Booking backend | Google Apps Script web app, session data Sheet, Google Calendar/Meet access, GCP project and consent | apps_scripts/; docs/booking-security-protocol.md; live deployment and trigger ownership require separate transfer. |
| Zendesk ticket creation | ZD_SUBDOMAIN, ZD_EMAIL, ZD_TOKEN | Apps Script Script Properties only; rotate token and update the backend. |
| Booking authentication | Permanent booking credential and short-lived signed session configuration | Keep permanent credentials server-side. Reissue after ownership transfer; verify request/response signing. |
| Calendar and theme config | TRAINING_CALENDAR_ID, TRAINING_DEFAULT_TZ; room_booking_api_url/mode; optional iframe URL and internal tag | Set intended calendar/timezone explicitly; update theme endpoint if backend redeployment changes it. |
| Google authorization | Receiving script executor, Calendar/Sheet grants and enabled APIs; OAuth consent where used | Reauthorize under the receiving account; inspect and recreate installable triggers under that identity. |

## API and OAuth completion requirements

For **every enabled API/OAuth integration**, record its accountable owner, provider/project, credential name, scopes, secret-store location, endpoint/redirect URI, expiry/renewal behavior and dependent consumers in the private operations register. Rotate/reissue all applicable keys, client secrets, tokens, grants and deployment credentials; configure each consumer; test the new identity; then revoke the superseded credentials. See the ordered procedure in [HANDOVER.md](HANDOVER.md).

Never put secret values in this file. If the live environment has additional integrations, add their non-secret dependency details before handover sign-off. Items absent from inspected source are unverified, not automatically unnecessary. This documentation update does not perform credential rotation or modify runtime settings.
