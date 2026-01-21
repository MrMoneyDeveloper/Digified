# Google Apps Script Reference

IMPORTANT
- These files are reference-only snapshots. Do not edit, deploy, or run them from this repo.
- The live Apps Script projects are deployed outside this repository. Changes here do nothing.
- If behavior must change, update the external Apps Script project and then refresh this folder.
- These files are not part of the theme build and should not be treated as source of truth just context to what is running on the deplyed.

## Scripts

### scriptA.gs - Room booking API web app
Purpose: Provides session availability and booking creation for the room booking page.

Connection
- Base URL and API key are configured in Zendesk theme settings: `room_booking_api_url` and `room_booking_api_key`.
- The front end calls JSONP GET requests.

Endpoints (query params)
- `action=sessions` with `from` and `to` in `YYYY-MM-DD`. Required: `api_key`. Optional: `callback` for JSONP.
- `action=book` with `slot_id`, `date`, `start_time`, `requester_name`, `requester_email`, `notes`, `api_key`. Optional: `callback`.

Data format (fields consumed by the theme)
- Sessions: array under `data.sessions` or `data.slots`. Each item uses `slot_id`, `date`, `start_time`, `end_time`, `status`, `capacity`, `booked_count`, `booker_name` or `reserved_by`, and `booked_at`.
- Booking response: `success` boolean, `data.booking_id`, optional `data.ticket_id`, plus `message` on errors.

### scriptB.gs - Training booking Zendesk ticket pipeline
Purpose: Triggered by updates to the training bookings sheet and creates Zendesk tickets, logging results.

Connection
- Script properties: `TRAINING_SHEET_ID` (optional), `ZD_SUBDOMAIN`, `ZD_EMAIL`, `ZD_TOKEN`.
- Sheets used: `BOOKINGS` and `LOGS`. Writes `zendesk_*` columns and tags tickets with `training-room-booking`.

### scriptC.gs - Training booking API web app
Purpose: Provides session availability and booking creation for the training booking page.

Connection
- Base URL and API key are resolved by `window.DigifyBookingConfig` (from `assets/booking-config.js`).
- The training booking template also defines `window.TRAINING_BOOKING_CFG` for inline validation; keep values in sync.
- The front end calls JSONP GET requests.

Endpoints (query params)
- `action=sessions` with `from` and `to` in `YYYY-MM-DD`, plus `api_key` and optional `callback`.
- `action=book` with `slot_id`, `requester_name`, `requester_email`, `user_type`, `notes`, `dept`, `api_key`, and optional `callback`.

Data format
- Same session and booking response shape as scriptA.gs. The booking payload includes `user_type` and optional `dept`.

## Related references
- See the root `README.md` for deployment URLs, API key initialization, and theme settings.
