# Profile avatars and comment participation

Apply `20261005045312_profile_avatars_and_guest_reactions.sql` manually after
`20261005032546_add_guest_comments_and_avatar_privacy.sql`, then deploy the code.
This task does not apply either migration or create Production Storage objects.

## Avatar

- `/api/profile/avatar` POST accepts exactly one `avatar` file. PATCH accepts only
  `{ "source": "default" | "social" | "uploaded" }`.
- Verified server session owns the profile. Original max 2MB; JPEG/PNG/WebP byte
  signatures and actual decode are validated, animated formats rejected. Output
  is 512px square WebP, without EXIF/metadata. Sharp loads only for image decoding.
- `profile-avatars` is public-read, server-write only, including a restrictive
  policy preventing authenticated/anonymous direct object mutations. Existing
  broad Storage policies should be reviewed when applying the migration.
- Random opaque object keys do not encode account UUIDs. Replacement RPC locks
  the profile and compares the expected uploaded path; a loser removes its own
  new object, not the winning image. Only the committed previous owned path is
  cleaned up; no provider URL or caller-supplied path is removed.
- Source changes retain the saved upload for switching back. Upload does not
  alter `show_avatar`. Only named comments with explicit opt-in show the image.
- Public image URLs, once known, remain readable even with opt-in off. Storage
  cleanup failure is nonfatal and logged without private URLs/IDs; deferred
  cleanup and account-deletion Storage cleanup are future operational work.
- An ambiguous network failure after RPC commit can leave an orphan; the API
  must not delete a potentially committed image without authoritative state.

## Comment sorting / reactions

- Root-only sorts: likes / dislikes / replies / latest; exact counter and time
  tie breakers followed by ID. Replies retain their original thread order.
- URL `?comments=...` persists sorting; canonical remains clean. Server sorts
  initial data, client re-sorts counts after successful reactions.
- Same HttpOnly `askio_guest_id` and `GUEST_ID_SECRET` as guest comments. No new
  secret or cookie. New stored actors are `guest:<HMAC>` / `account:<verified ID>`.
  Caller identity fields and fingerprint headers never authorize reactions.
- Existing fingerprint rows/counts are retained, not migrated. They cannot be
  securely linked to an account from an untrusted browser fingerprint, so their
  previous selection is not claimed by new account actors. A legacy browser's
  first new account reaction may coexist with its old fingerprint reaction.
- Existing unique(comment_id,user_fingerprint) reused, atomic toggle RPC locks
  poll then comment, same ordering as moderation. Counts recomputed in transaction.
  Concurrent same-actor requests serialize; two toggles of the same reaction
  cancel each other. The UI suppresses overlapping clicks for the same comment.
- Public responses include counts and current requester reaction only. Direct
  public Data API access to actor keys is revoked. `/me` remains questions/comments.
  Raw reaction Realtime subscriptions are removed for privacy; the existing
  20-second server refresh still syncs other viewers' counts. Own toggles update
  immediately. Poll/comment subscriptions are unchanged.
- Existing in-memory IP rate limit remains; cookie deletion is not a strong
  one-person identity guarantee. No fingerprinting, CAPTCHA or account/guest merge.

## Deployment verification

Confirm bucket public/read and no client writes; upload with a real account,
replace image, verify opt-in off/on and anonymous privacy. Verify two separate
guest browsers, reload reaction state, query back/forward, hide/restore behavior.
No Production test activity was created by automated mock checks.
