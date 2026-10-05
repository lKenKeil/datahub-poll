# Guest comments and account activity

## Manual deployment (not applied by this change)

1. Apply `20261005032546_add_guest_comments_and_avatar_privacy.sql` after
   `20261004155055_add_user_profiles_and_authorship.sql`. Deploy schema before
   the matching application: public comment reads now require `anonymous_alias`.
2. Set **server-only** `GUEST_ID_SECRET` in Vercel Production to a cryptographically
   random secret of at least 32 characters (recommended: 32 random bytes encoded
   as hex/base64). Never prefix it with `NEXT_PUBLIC_`, print it, or commit it.
   Use a separate secret for development/staging. Redeploy after setting it.
3. Validate in staging before production. No migration or live comment was
   submitted during implementation. Mock tests do not verify live SQL locks/RLS.

The new migration adds nullable comment identity columns and `show_avatar=false`.
There is no content backfill, deletion, account linking, vote change or owner
token change. Existing anonymous rows continue to display their legacy fallback.

## Identity and privacy

`askio_guest_id` is a random v4 UUID in an HttpOnly, SameSite=Lax, Path=/ cookie
lasting one year. HTTPS uses Secure; local HTTP loopback remains usable.
Only an HMAC-SHA256 hash is stored. Raw cookie IDs never enter DB, logs, public
JSON or analytics. Client-supplied account/guest/display identity is ignored.

Both guests and authenticated anonymous authors receive a deterministic alias
scoped to a question: 20 neutral animals + two digits. Display aliases can
collide; they are **not** unique IDs. Clearing cookies creates a new guest.
Logging in never attaches prior guest comments to an account. Keep the secret
stable; rotation changes guest hashes/aliases and resets guest continuity.

Logged-in anonymous authors keep their verified user ID internally, never in
public comment JSON. Public anonymous comments omit nickname and avatar fields.
Account photos default off, appear on named comments only after explicit opt-in,
and are fetched from the provider URL with no referrer. No upload is implemented.

The server-only RPC uses SECURITY INVOKER; only service_role may execute it.
Public roles receive a safe column projection, not comments.user_id or
guest_id_hash. Profiles retain existing own-row RLS. `/api/me` selects by verified
session ID, excludes guests and hidden content, and is private/no-store.
Activity is read-only and capped at 100 recent entries in each list.

## Spam controls and limitations

- Existing IP comment policy: 10 requests/minute per process (not distributed).
- Guest RPC: global 10-second cooldown, protected by a transaction advisory lock.
- Same guest + question + trimmed text: duplicate blocked for 10 minutes.
- Multiple recognized URLs in a guest message: rejected. This is a basic heuristic,
  not a complete spam scanner. Cookie resets still rely on the existing IP limit.
- Expired/invalid supplied Auth credentials fail closed rather than becoming guests.
- Missing secret: guest and logged-in anonymous posting return a generic 503;
  named account comments remain available after migration.
- Question creation and reactions remain login-required. Voting is unchanged.

## Staging verification after applying migration

1. Direct REST `anon` and `authenticated` SELECT of `guest_id_hash` and `user_id`
   must fail; safe comment columns remain readable only for visible content.
   Public roles cannot execute `create_comment_with_identity` or INSERT comments.
2. Submit guest comment/reply: verify cookie flags, internal hash (not raw UUID),
   same-question alias, no private fields in public JSON. Concurrent submissions
   by the same guest must yield one success and cooldown429, without partial rows.
3. Named login: nickname only, default photo hidden. Opt in/out and reload:
   header/profile/named comments reflect the preference. Anonymous remains private.
4. `/me`: own questions, own comments/replies including anonymous; exclude other
   accounts, guests, legacy-null authors, hidden rows. Arbitrary query IDs rejected.
5. Keep existing Google/Kakao/email OTP, create, reaction, voting, report, owner
   and moderation flows working. Do not submit test content to Production.
6. Check account menu/profile/comment author rows at 375/390/430/1440, both themes.

Regression commands:

```text
node scripts/test-moderation-routes.mjs
node scripts/test-email-auth.mjs
node scripts/test-poll-discovery.mjs
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

The earlier `user-accounts.md` login-required comment check describes the previous
release; this document supersedes it for guest comments/replies only.
