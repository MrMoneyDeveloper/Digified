## Required Files for Zendesk Deployment

- `manifest.json` (bump `version` on every deploy)
- `settings_schema.json` (must include Room booking and Training booking settings)
- `templates/custom_pages/home_internal.hbs`
- `templates/custom_pages/home_tenant.hbs`
- `templates/custom_pages/room_booking.hbs`
- `assets/room-bookings.css`
- `assets/room-bookings-calendar.js`
- `templates/header.hbs` (role-based quick links and nav classes)
- `templates/document_head.hbs` (includes build marker)

## Routing Notes

- Zendesk auto-renders `templates/home_page.hbs` for `/hc/{locale}`.
- `templates/custom_pages/home_internal.hbs` and `templates/custom_pages/home_tenant.hbs` require Zendesk custom pages with slugs `home_internal` and `home_tenant`.
- `templates/home_page.hbs` can redirect segmented users to those slugs after `window.DigifiedSegments` is resolved.
- `script.js` normalizes legacy `/hc/{locale}/room_booking` URLs to `/hc/{locale}/p/room_booking`.

## GitHub Pull Checklist

1. Commit and push changes to the Zendesk-connected branch.
2. In Zendesk Guide, run **Update from GitHub**.
3. Publish the updated theme.
4. Verify page source contains the current `BUILD_MARKER`.
