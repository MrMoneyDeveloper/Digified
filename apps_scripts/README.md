# Google Apps Script Reference

IMPORTANT
- These files are reference-only and are not packaged into the Zendesk theme ZIP.
- The live Apps Script projects run on Google servers; deploy changes there.
- Do not treat these files as source of truth for the theme build.

## Files

### script0.json - Apps Script manifest config
Reference manifest settings for the Apps Script project that hosts Scripts A/B/C.
Includes:
- `runtimeVersion: V8`
- `timeZone: Africa/Johannesburg`
- Web app settings (`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`)
- Advanced Calendar service (`Calendar` v3)

Note: In the Apps Script editor, this content belongs in the project manifest
file named `appsscript.json`.

### scriptA.gs - Room booking API
Handles the automatic unsigned JSONP `action=session_init` bootstrap plus signed
`action=sessions`, `action=days`, and `action=book` calls for the room booking UI.
It writes bookings to the `BOOKINGS` sheet and stores:
- `meeting_type`
- `attendee_emails`
- `meet_link`
- `meet_status` / error details

If `meeting_type` is `in_person_plus_online`, Script A calls Script C
(`createMeetForBooking_C_(...)`, with `createOnlineMeeting(...)` fallback compatibility)
and writes returned `meet_*` fields back to the same booking row.

### scriptB.gs - Zendesk ticket pipeline
Reads new bookings from the `BOOKINGS` sheet and creates Zendesk tickets.
It includes meeting details in the ticket description:
- Meeting type
- Attendee emails
- Google Meet link (when `meet_status=ok`)
- Meet pending/failed state and error context

### scriptC.gs - Google Meet generator
Defines `createMeetForBooking_C_(params)` for hybrid bookings and keeps
`createOnlineMeeting(params)` as a compatibility wrapper.
Script A calls this only when remote attendees are included.

## Theme integration notes
- `session_init` returns a short-lived temporary session automatically through
  JSONP. It never returns the server-only master secret.
- Set the server-only `BOOKING_MASTER_SECRET` in Apps Script Script Properties
  before deployment. `initializeBookingSecurity()` creates it when absent.
- Zendesk remains responsible for end-user login, segments, and page access;
  Apps Script performs no end-user role, domain, email, or approval checks.
- The front end uses the temporary session to sign JSONP calls for normal booking
  actions such as `sessions`, `days`, and `book`, and verifies signed responses.
- Only the public Apps Script base URL comes from `assets/booking-config.js`.
- Apps Script code must be deployed separately; these files are for context only.
