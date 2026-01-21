# Google Apps Script Reference

IMPORTANT
- These files are reference-only and are not packaged into the Zendesk theme ZIP.
- The live Apps Script projects run on Google servers; deploy changes there.
- Do not treat these files as source of truth for the theme build.

## Files

### scriptA.gs - Training booking API
Handles `action=sessions` and `action=book` for the training booking UI.
It writes bookings to the `BOOKINGS` sheet and stores:
- `meeting_type`
- `attendee_emails`
- `meet_link`

If `meeting_type` is `online`, Script A calls `createOnlineMeeting(...)`
from Script C and writes the returned Meet link back to the booking row.

### scriptB.gs - Zendesk ticket pipeline
Reads new bookings from the `BOOKINGS` sheet and creates Zendesk tickets.
It includes meeting details in the ticket description:
- Meeting type
- Attendee emails
- Google Meet link

### scriptC.gs - Google Meet generator
Defines `createOnlineMeeting(params)` and returns `{ ok, meet_link }`.
Script A calls this only for online meetings.

## Theme integration notes
- The front end uses JSONP calls to the Apps Script web app with `action=sessions` and `action=book`.
- The base URL and API key come from Zendesk theme settings or `assets/booking-config.js`.
- Apps Script code must be deployed separately; these files are for context only.
