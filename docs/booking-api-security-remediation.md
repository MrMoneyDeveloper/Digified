# Booking API security remediation

## Incident

A shared booking API key was embedded in public Zendesk Help Center JavaScript/template assets. Because the Apps Script web app was deployed with `ANYONE_ANONYMOUS`, possession of that client-side value allowed anonymous calls to the booking API.

A browser-delivered JavaScript bundle cannot safely hold a secret. Moving the value from one public asset into another theme setting would only relocate the problem.

## New security boundary

The booking web app is restricted to the Google Workspace domain:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "DOMAIN"
}
```

`workspace-auth` is intentionally **not a secret**. It exists only to satisfy Script A's legacy `requireApiKey_` check while the Google Workspace deployment performs the actual access control.

## Deployment order

1. Copy the patched `apps_scripts/appsscript.json` and `apps_scripts/securityMigration.gs` into the Apps Script project.
2. Run `migrateBookingApiToWorkspaceDomain()` once from the Apps Script editor.
3. Confirm `verifyBookingSecurityMigration()` returns `ok: true`.
4. Create/update the Apps Script web-app deployment so access is limited to users in the Workspace domain. Do not leave an older `ANYONE_ANONYMOUS` deployment active.
5. Test the web-app URL in a browser signed into the company Google Workspace account.
6. Publish the patched Zendesk Help Center theme.
7. Test room availability and a test booking from the Help Center.
8. Test the Apps Script URL signed out or with a non-domain Google account. Access must be denied before booking data is returned.

## Credential revocation

The old key must be treated as compromised even after it disappears from the current source tree. Git history, caches, browser caches, and previously published Zendesk assets can retain it.

Running `migrateBookingApiToWorkspaceDomain()` replaces the live Script Property and the `SETTINGS` sheet value with the non-secret compatibility value, so the historical key no longer satisfies Script A's check.

Do not reintroduce API keys into:

- Zendesk theme JavaScript
- Handlebars templates or `data-*` attributes
- Zendesk theme settings
- public repositories
- browser local/session storage

## Compatibility note

The current booking client uses JSONP and still expects an `apiKey` string. `assets/booking-config.js` now supplies the public `workspace-auth` compatibility value. This is not authentication. Google Workspace sign-in is the authentication layer.

A later cleanup can remove `requireApiKey_` and the compatibility parameter from Script A/client code entirely once the Apps Script source is refactored together.
