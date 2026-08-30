# Bold kinetic theme refresh checklist

This release removes permanent browser credentials and uses an automatic unsigned JSONP session bootstrap while preserving the signed v1 booking protocol and existing theme presentation. Zendesk remains the end-user page-access boundary. Deploy Apps Script first, verify automatic bootstrap, and only then upload the matching Zendesk theme.

## Automated checks

- `node tests/booking-security.test.js`
- `node tests/booking-automatic-bootstrap.test.js`
- `node tests/theme-contract.test.js`
- JavaScript syntax checks for `script.js`, `assets/theme-ui.js`, `assets/theme-motion.js`, `assets/booking-security.js`, `assets/room-bookings-calendar.js`, and `assets/training-bookings-calendar.js`
- CSS structural validation for `style.css` and `assets/training-bookings.css`
- Confirm `git diff main -- apps_scripts/scriptB.gs apps_scripts/scriptC.gs` is empty
- Confirm `apps_scripts/script0.json` uses `ANYONE_ANONYMOUS` / `USER_DEPLOYING` and excludes the `userinfo.email` scope
- Confirm the credential and API-key pattern scan returns no browser-accessible permanent booking secret
- Confirm the release ZIP excludes `apps_scripts`, `tests`, and `theme_export`

## Responsive and visual checks

- Preview widths: 360, 640, 768, 1024, 1280, 1536, 1920, and 2560 px
- Include a short mobile viewport and 200% browser zoom
- Check anonymous, untagged/pending, internal, tenant, management, and learner navigation states
- Check home, policies, article, category, section, search, new request, request history/detail, community, profile, subscriptions, services, approval, and error views
- Confirm the header disclosure works with mouse, touch, Enter/Space, Escape, outside click, and JavaScript disabled
- Confirm focus is visible, touch targets remain usable, contrast remains readable, and content order is logical for a screen reader
- Confirm reduced-motion and data-saving preferences suppress optional motion
- Confirm content stays visible when Alpine or GSAP fails to load

## Booking fixture checks

Open `tests/booking-ui-harness.html` locally. It is a non-production visual fixture and sends no network requests.

- Exercise normal, loading, empty, error, and modal states
- Check room image and visible placeholder behavior
- Check calendar horizontal scrolling, tap/keyboard cells, selection styling, and narrow screens
- Check repeat-day controls, requester fields, attendee rows, Google Meet option, and modal Escape behavior
- After deploying Apps Script, verify automatic bootstrap, availability, repeat-day booking, and Calendar/Meet behavior before uploading Zendesk

## Performance and release checks

- Confirm no loader-video request, forced paint delay, or base64 room-preview request occurs
- Confirm below-fold media uses native lazy loading and known local images have intrinsic dimensions
- Confirm Alpine and GSAP are deferred and no HTMX, Workbox, lozad, Lenis, date-fns, or Tailwind runtime is present
- Compare Lighthouse accessibility and Core Web Vitals against the current production theme
- Rebuild `digified-theme.zip`, inspect forward-slash archive paths, and confirm `manifest.json` reports `2028.2.2`
- Do not publish the ZIP to Zendesk until the automatic Apps Script bootstrap is deployed and verified
