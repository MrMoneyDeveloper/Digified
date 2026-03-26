# Reusable Asset Pack

## Digify Room Booking Integration

Status: Draft reusable asset pack  
Purpose: Template kit for repeating the Digify room-booking solution for a new client without re-engineering the core flow.

## 1. Current Process State

This implementation is currently a lean Zendesk asset setup.

Confirmed current state:

- 1 Zendesk view
- 1 Zendesk trigger
- 1 Zendesk custom field currently in use
- no macros
- no broader custom field library confirmed
- no larger trigger/automation pack confirmed
- core ticket creation is handled by Apps Script B
- booking source of truth is Google Sheets
- optional Google Meet creation is handled by Apps Script C

Important note:

- the current repo shows that a booking ID custom field is still being passed into Zendesk
- if the final setup is intended to have no custom fields, Script B must be changed before this pack is finalised

Current confirmed custom field in code:

- `booking_id` Zendesk custom field ID: `24568268312988`

## 2. Confirmed End-to-End Process

The current process works as follows:

1. User opens the Zendesk Help Centre room booking page
2. Theme JS / booking config loads available slots from Apps Script A
3. Apps Script A reads and writes booking data in Google Sheet
4. If needed, Apps Script A calls Apps Script C to create a Google Calendar event / Google Meet link
5. Apps Script B reads the booking row from Google Sheet
6. Apps Script B creates a Zendesk ticket
7. Zendesk applies the booking view / trigger logic
8. Ticket is confirmed, tagged, assigned, and solved according to the current booking workflow

## 3. Confirmed Zendesk Assets

### 3.1 View

View name: `CXI Training Room Bookings`

Purpose:  
Shows all room booking tickets created through the integration.

Access groups:

- `Facilities - Admin`
- `Facilities - Management (Oversight)`

Conditions:

- Ticket > Tags contains at least one of: `training-room-booking`
- Ticket > Ticket status contains at least one of: `Open`, `Solved`

Columns:

- Requester
- Request date
- Subject
- Ticket status

Sort order:

- Order by Request date
- Descending

### 3.2 Trigger

Trigger name: `CXI Bookings - Solved`

Purpose:  
Processes booking tickets after creation, adds notification tagging, and sets the ticket to solved.

Conditions:

- Tag contains `training-room-booking`
- Status is `Open`
- Tag does not contain `training-room-notified`

Actions:

- Add tag: `training-room-notified`
- Set status: `Solved`
- Assign group: `Facilities - Admin`
- Set brand: `digifyCX`

Message / note currently shown in configuration:

```text
Auto-confirmation email sent to requester.
Tag added: training-room-notified
Ticket set to Solved
```

## 4. Confirmed Tags

Required booking tag:

- `training-room-booking`

Trigger / notification tag:

- `training-room-notified`

Default tags currently added by Script B:

- `api-integration`
- `automated`

Meeting mode tags currently added by Script B:

- `meeting-hybrid`
- `meeting-in-person-only`

Meet status tags currently added by Script B when applicable:

- `meet-failed`
- `meet-pending`

Alert / failure tags currently used for alert ticket path:

- `booking-error`
- `automated-alert`
- `urgent`

Additional tag behaviour confirmed from code:

- Script B also adds a department tag in the format `dept-[slugified-department]`
- example output for Training Room 1: `dept-training-room-1`
- example output for Interview Room: `dept-interview-room`

## 5. Confirmed Ticket Payload Behaviour

Apps Script B currently creates the Zendesk ticket with the following structure.

### Ticket subject

Format:

- `[Room / Department] Booking - [Session Window]`

Confirmed from live code:

- `Training Room 1 Booking - 2026-03-24 19:00-20:00`
- `Training Room 2 Booking - 2026-03-25 15:30-16:30`
- `Interview Room Booking - 2026-03-24 19:00-20:00`

Source:

- `C:\Workspace\Digified\apps_scripts\scriptB.gs:666`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:1157`

### Requester

Taken from booking row:

- requester email
- requester name

### Comment body

The ticket body currently includes:

- booking reference
- room / department
- session window
- requester name and email
- meeting mode
- Google Meet link when available
- remote participant email list when applicable
- booking timestamp
- notes
- system footer stating ticket was auto-created via Room Booking API

Confirmed current body template from code:

```text
Room Booking Confirmation
=====================================

Booking Reference: [booking_id]
Room: [dept]
Session: [start_date] [start_time]-[end_time]
Requester: [requester_name] ([requester_email])
Meeting Mode: [In-person only | In-person + Remote (Meet)]
[Google Meet details block when applicable]
Booked At: [booked_at]

[Notes block only if notes were supplied]
---
This ticket was auto-created via Room Booking API
```

Confirmed live/code-derived hybrid additions:

- `Google Meet Link: [meet_link]`
- `Remote participants (Calendar invites): [attendee_emails]`
- `Requester access: requester is included on Calendar guests and also receives this link in Zendesk.`
- `Meet Access Warning: [meet_error_code] - [meet_error_details]` when the meet exists but access patching throws a warning

Confirmed live/code-derived failed Meet additions:

- `Meet generation failed.`
- `Meet Error Code: [meet_error_code]`
- `Meet Error Details: [meet_error_details]`

Source:

- `C:\Workspace\Digified\apps_scripts\scriptB.gs:700`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:727`

### Ticket status on creation

- `open`

### Tags applied on creation

- `training-room-booking`
- `api-integration`
- `automated`
- meeting-mode tags where applicable
- meet-status tags where applicable
- department tag where applicable

### Custom fields currently passed

- booking ID custom field

### Optional values passed when configured

- brand ID
- ticket form ID

Source:

- `C:\Workspace\Digified\apps_scripts\scriptB.gs:744`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:749`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:750`

## 6. Field Mapping Table

Confirmed mappings:

| Source sheet field | Script B booking object | Zendesk output |
| --- | --- | --- |
| `booking_id` | `booking.bookingId` | Custom field + ticket body |
| `slot_id` | `booking.slotId` | Used to build session display |
| `requester_email` | `booking.requesterEmail` | Requester email + ticket body |
| `requester_name` | `booking.requesterName` | Requester name + ticket body |
| `notes` | `booking.notes` | Ticket body |
| `dept` | `booking.dept` | Subject + tag + ticket body |
| `start_date` | `booking.startDate` | Session window |
| `start_time` | `booking.startTime` | Session window |
| `end_date` | `booking.endDate` | Session window |
| `end_time` | `booking.endTime` | Session window |
| `duration_minutes` | `booking.durationMinutes` | Session window fallback logic |
| `booked_at` | `booking.bookedAt` | Ticket body |
| `meeting_type` | `booking.meetingType` | Ticket body + meeting tags |
| `attendee_emails` | `booking.attendeeEmails` | Ticket body |
| `meet_link` | `booking.meetLink` | Ticket body |
| `meet_status` | `booking.meetStatus` | Ticket body + tags |
| `meet_error_code` | `booking.meetErrorCode` | Ticket body when relevant |
| `meet_error_details` | `booking.meetErrorDetails` | Ticket body when relevant |

Confirmed additional sheet columns used in live flow:

- `zendesk_status`
- `zendesk_ticket_id`
- `zendesk_ticket_url`
- `zendesk_error_code`
- `zendesk_error_details`
- `zendesk_attempted_at`
- `alert_ticket_id`
- `alert_ticket_url`

These are not part of the incoming booking payload. They are Script B pipeline state columns used to avoid duplicate ticket creation and to retain audit/error state.

Source:

- `C:\Workspace\Digified\apps_scripts\scriptB.gs:1030`

## 7. Required Config / Placeholder Dictionary

These are the values that must be replaced for a new client.

### Zendesk connection values

- `ZD_SUBDOMAIN` -> `cxe-internal`
- `ZD_EMAIL` -> `mohammed@cxexperts.co.za`
- `ZD_TOKEN` -> `pilot hardcoded fallback exists in Script B; do not reuse - move to secure script property / vault for a new client`
- `ZD_BRAND_ID` -> `blank in current pilot hardcoded fallback`
- `ZD_TRAINING_FORM_ID` -> `blank / not confirmed in current pilot hardcoded fallback`
- `ZD_ALERT_FORM_ID` -> `blank / not confirmed in current pilot hardcoded fallback`
- `ZD_ALERT_REQUESTER_EMAIL` -> `blank / not confirmed in current pilot hardcoded fallback`
- `ZD_ERROR_EMAIL_TO` -> `blank / not confirmed in current pilot hardcoded fallback`

### Google / Apps Script values

- `TRAINING_SHEET_ID` -> `1FqFxTGqsAc0yhGSdp0XJidoFS1DPIXglSk6wo_PtqbU`
- `MEET_CALENDAR_ID` -> `primary`
- `TRAINING_DEFAULT_TZ` -> `Africa/Johannesburg`
- `TRAINING_API_KEY` -> `c8032a6a14e04710a701aadd27f8e5d5`

### Help Centre / theme values

- Help Centre hostname -> `cxe-internal.zendesk.com`
- room booking page URL -> `https://cxe-internal.zendesk.com/hc/en-us/p/room_booking`
- training booking page URL -> `not confirmed live in pilot; if deployed as a custom page the expected route is https://cxe-internal.zendesk.com/hc/en-us/p/training_booking`
- API base URL in theme wiring -> `https://script.google.com/macros/s/AKfycbwLge7qDCPemVqE2MsmB11HTZBOJcjFWYjj5yNLGzXKh_qVieGo8Yf5QWVTqt7xB_FU/exec`

### Zendesk asset values

- booking ID custom field ID -> `24568268312988`
- admin group -> `Facilities - Admin`
- oversight group -> `Facilities - Management (Oversight)`
- brand name -> `digifyCX`

### Code references for copy / replace

- `C:\Workspace\Digified\apps_scripts\scriptB.gs:49`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:50`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:51`
- `C:\Workspace\Digified\apps_scripts\scriptB.gs:59`
- `C:\Workspace\Digified\assets\booking-config.js:12`
- `C:\Workspace\Digified\assets\booking-config.js:13`
- `C:\Workspace\Digified\templates\custom_pages\room_booking.hbs:5`
- `C:\Workspace\Digified\templates\custom_pages\room_booking.hbs:6`
- `C:\Workspace\Digified\templates\custom_pages\training_booking.hbs:823`
- `C:\Workspace\Digified\templates\custom_pages\training_booking.hbs:824`
- `C:\Workspace\Digified\templates\header.hbs:80`
- `C:\Workspace\Digified\templates\header.hbs:82`

## 8. Sample Success Path

Real example from provided pilot rows:

- booking type: `IN-PERSON`
- booking reference: `book_75976e59_1774350287451`
- requester name: `Mohammed farhaan Outllook`
- requester email: `mohammedfarhaanbuckas@outlook.com`
- room / department: `Training Room 1`
- session window: `2026-03-24 19:00-20:00`
- booking row written to Google Sheet: `YES`
- Meet link created: `NO`
- Zendesk ticket created: `YES`
- Zendesk ticket URL: `https://cxe-internal.zendesk.com/agent/tickets/1829`
- ticket tags applied: `training-room-booking`, `api-integration`, `automated`, `meeting-in-person-only`, `dept-training-room-1`
- ticket solved by trigger: `YES, based on the currently configured Zendesk trigger conditions`

Why this counts as the best confirmed success example:

- the booking row shows a real booking reference
- the row includes a real Zendesk ticket ID and URL
- it proves the Script A -> Script B -> Zendesk path completed

## 9. Sample Failure Path

Real example from provided pilot rows:

- failure type: `MEET ACCESS PATCH FAILED / HYBRID BOOKING WARNING`
- booking reference: `book_b47b9333_1774445434959`
- requester name: `Mohammed farhaan Outllook`
- requester email: `mohammedfarhaanbuckas@outlook.com`
- room / department: `Training Room 2`
- session window: `2026-03-25 15:30-16:30`
- booking row written to Google Sheet: `YES`
- Meet link created: `YES`
- Meet link: `https://meet.google.com/yms-ziha-mdz`
- event ID: `8jctohq3v6mu0vuakipsd78n3o`
- error code: `MEET_SPACE_LOOKUP_FAILED`
- error details: `HTTP 403 - Google Meet API has not been used in the linked project or is disabled / not fully authorised`
- fallback behaviour: `booking succeeded, Meet link was created, but automatic no-admit access setting failed so guests may still wait in the lobby`
- alert ticket created: `NO EVIDENCE PROVIDED`
- manual follow-up required: `YES if the business requirement is lobby-free external joining`

This is not a total booking failure. It is a hybrid booking success with a Meet access warning.

## 10. Items Still Needed To Finalise This Pack

The following still needs to be gathered and inserted.

### Required placeholders still missing

- whether the live Zendesk API user for production is still `mohammed@cxexperts.co.za` or a shared service account
- whether a live `ZD_TRAINING_FORM_ID` is set via script properties
- whether a live `ZD_BRAND_ID` is set via script properties
- whether the alert path is active with `ZD_ALERT_FORM_ID`
- whether the training booking page is actually deployed live or only retained in the repo
- one confirmed hybrid booking example that also includes the final Zendesk ticket ID after Script B processing

### Confirmation still needed

- whether the booking ID custom field remains in scope
- whether a form ID is used in live production
- whether an alert ticket path is active in production
- whether any other Zendesk views or triggers exist outside the current lean setup

## 11. Copy-Forward Checklist

For a new client rollout:

1. Replace Zendesk credentials
2. Replace sheet and calendar ownership values
3. Rotate API key
4. Replace Help Centre hostname and live URLs
5. Confirm booking ID custom field ID
6. Confirm view access groups
7. Confirm trigger brand/group actions
8. Run one in-person test booking
9. Run one hybrid test booking
10. Confirm ticket creation and trigger solve behaviour
11. Confirm booking visibility in the view
12. Confirm Meet behaviour if hybrid booking is enabled


