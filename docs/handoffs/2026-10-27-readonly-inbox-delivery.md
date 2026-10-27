# Read-only native TikTok inbox delivery

Source baseline: fac5491dfe3099e083fbf8fc73c2d4b251639e57. Isolated branch
`dev/minicodex-inbox-observation-20261027`. Integration source is authorized;
the exact additional test matrix is pending. No tests, dependencies, builds,
provider calls, credential/channel changes or deployment ran in this lane.

## Existing authenticated surface

`GET /api/public/v1/posts/:id/inbox-delivery` remains inside PublicApiModule's
existing PublicAuthMiddleware. It accepts only the authenticated organization,
rejects admin organization/include-deleted headers and all query selectors, and
sets private/no-store. The controller has a four-second response budget and
cancels the native read on client disconnect. No write or provider endpoint is
called. Existing routes, channels, grants and credentials are unchanged.

The repository selects only the owned root post's identity, state, one-video
settings/reference and integration public account fields. No integration token,
refresh token, caption or provider/session object is selected. A second scoped
media query checks the ready object's exact ID/path; legacy media rows default
to type image even for MP4, so this route validates the MP4 path and existing
Publish receipt MIME rather than changing stored type or relying on that label.
Both selected post and media snapshots must remain identical after observation.
Future scheduled/repeating posts, drafts, disabled/reconnecting channels,
non-TikTok, absent consent and non-UPLOAD material are ineligible.

## Bounded native evidence

The existing Temporal client describes only `post_<ownedPostId>`, pins its exact
run, reads one history page (maximumPageSize501, reject over500 or another page),
and rechecks the run. The native gRPC scope has a 3.5-second deadline and AbortSignal;
no connection, arbitrary workflow selector, history pagination or provider poll is
created. The decoder permits only the pinned postWorkflowV112 start identity,
postSocialPending's credential-free completion/publish ID, checkPostStatus's
second scheduled pending-data argument, and its completion. It never accesses the
first Integration argument, refresh results or unrelated activity payloads.
JSON/plain only; each decoded payload<=65536bytes; total decoded<=1MiB.

Only completed checkPostStatus with deliveryStatus inbox, postId missing and the
pinned TikTok inbox URL, matching the post's native publish ID and owned/current
PUBLISHED material, yields SEND_TO_USER_INBOX. The event timestamp must be current
within five minutes and not future. Missing/truncated/malformed history, a changed
run/material, generic PUBLISHED/public success, pending and opaque failure stay
UNKNOWN. No inferred native processing subtype or FAILED claim is invented from
an activity exception. Reading old history never refreshes its authoritative time.

## Frozen wire shape and Publish handoff

Exactly eight fields: postizPostId, channelId, mediaId, publishId,
providerAccountId, status, source, checkedAt. source is tiktok_status; unavailable
proof may use null publishId/checkedAt. The contract's other status symbols remain
reserved for genuine native evidence; this decoder currently emits only UNKNOWN
or SEND_TO_USER_INBOX. No credential, raw history, caption or raw error leaves the
projection. The Publish Lead's existing tenant-selected Postiz client consumes
this GET, then joins the committed manual operation, h1_ actor/channel media
receipt and hash before exposing the existing eleven-field observation.
The canonical Portal delivery DTO and operation enum are unchanged.

## Ownership and verification

A concurrent Publish-side implementation was detected before any commit. Its
owner explicitly withdrew only its overlapping additions and preserved them
separately. This candidate retains one endpoint/service/repository implementation
and this decoder. Existing Publish working files were not edited from this lane.

The proposed 20-case fixed matrix is at the root task handoff and has not been
approved or implemented. No new tests/config/workflow is included here. Do not
claim the existing Postiz CI placeholder qualified this code, or deploy it without
approved hosted qualification and matched immutable package custody. Main-only
source review must follow the owner's route, never a staging cascade or bypass.
