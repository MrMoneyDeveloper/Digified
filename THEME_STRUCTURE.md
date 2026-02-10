## Required Files for Zendesk Deployment

- `manifest.json` (bump `version` on every deploy)
- `settings_schema.json` (must include Room booking and Training booking settings)
- `templates/home_internal.hbs`
- `templates/home_tenant.hbs`
- `templates/custom_pages/room_booking.hbs`
- `assets/room-bookings.css`
- `assets/room-bookings-calendar.js`
- `templates/header.hbs` (role-based quick links and nav classes)
- `templates/document_head.hbs` (includes build marker)

## Routing Notes

- Zendesk auto-renders `templates/home_page.hbs` for `/hc/{locale}`.
- `templates/home_internal.hbs` and `templates/home_tenant.hbs` are not auto-routed by default.
- To use separate internal/tenant pages, create custom pages in Zendesk Guide and map the templates you want to expose.

## GitHub Pull Checklist

1. Commit and push changes to the Zendesk-connected branch.
2. In Zendesk Guide, run **Update from GitHub**.
3. Publish the updated theme.
4. Verify page source contains the current `BUILD_MARKER`.
