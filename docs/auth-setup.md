# Askio authentication setup

Reading, search, results and the existing anonymous voter-ID system remain
public. Creating questions, writing comments/replies and changing comment
reactions require a verified Supabase Auth user. Reporting and the admin secret
remain independent of user login.

## Apply the migration before deploying

Manually review and run
`supabase/migrations/20261004140201_add_authenticated_comments.sql` in the
intended project's Supabase SQL Editor before deploying this code. It adds a
nullable comment author reference and index only; existing rows are not
backfilled. The implementation does not apply this migration automatically.

Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configure
the cookie-based browser/server Auth clients. Keep `SUPABASE_SERVICE_ROLE_KEY`
server-only. No Google/Kakao provider secrets belong in application code or
public environment variables.

## Supabase Dashboard

For project `ckacekbnzfuoiazicxil`, configure Authentication → URL Configuration:

- Site URL: `https://askio.quest`
- Redirect URLs: `https://askio.quest/auth/callback` and
  `http://localhost:3000/auth/callback`
- Identity linking also uses the fixed application callback
  `https://askio.quest/auth/callback/link` (and
  `http://localhost:3000/auth/callback/link` for local testing).
- New login/link requests use these exact callback URLs, without a `next`
  query. The validated return path is preserved in a short-lived, signed
  first-party HttpOnly cookie. Keep historical query-bearing callback entries
  only if they are still needed for in-progress/older deployments; no new
  whole-site wildcard is necessary.
- If testing a different local port, explicitly allow its callback URL too.
  Do not add broad production redirect wildcards.

The provider-facing callback is different from the application callback:

`https://ckacekbnzfuoiazicxil.supabase.co/auth/v1/callback`

Confirm this URL in each provider panel before saving. Custom Auth domains, if
introduced later, change this URL. The app's `/auth/callback` exchanges a PKCE
code, then returns to a validated same-origin path. Failed/cancelled login
returns to a generic login page without provider error details.

## Google

1. In Google Cloud's Google Auth Platform, configure Branding/Audience and
   create a Web application OAuth client. Add test users while the app remains
   in testing mode; publish/verify the consent screen as Google requires for
   public use.
2. Authorized JavaScript origins: `https://askio.quest` and
   `http://localhost:3000`.
3. Authorized redirect URI:
   `https://ckacekbnzfuoiazicxil.supabase.co/auth/v1/callback`.
4. In Supabase Authentication → Sign In / Providers → Google, enable Google
   and save the Web client ID and client secret privately.

## Kakao Developers

1. Select the intended application and activate Kakao Login.
2. In App Settings → App → Platform Key, configure the REST API key's redirect
   URI as `https://ckacekbnzfuoiazicxil.supabase.co/auth/v1/callback`.
   Enable its Kakao Login client secret. Dashboard labels may vary; the
   redirect must be the Supabase Auth callback, not `/auth/callback` on Askio.
3. Configure the application service domain as `https://askio.quest` and the
   applicable profile consent items (`profile_nickname`, `profile_image`).
   Email is optional for this implementation. If not requesting email, enable
   Supabase's Kakao option to allow users without an email address; obtaining
   `account_email` may require Kakao permissions/Biz App configuration.
4. In Supabase Authentication → Sign In / Providers → Kakao, enable Kakao and
   save the REST API key as client ID and activated client secret privately.

## Manual acceptance checks after configuration

- Log in with Google and Kakao, refresh, and navigate between pages. Verify
  the shared account menu retains the session.
- Return to `/create` after login; create a disposable question and retain its
  owner token through the existing browser flow.
- Write a comment/reply and react. Verify the new comment's `user_id` matches
  the verified Auth user and the display name is server-derived.
- Log out, then verify question/comment/reaction mutations return 401 while
  public reading and anonymous voting still work.
- Verify cancelled login, expired sessions, safe return paths, hidden content
  restrictions and the separate admin-key controls.
- Use a development/staging project for mutation tests; do not leave test
  votes/comments in Production.

## Deliberate limits

- Account login does not replace or recover owner tokens. Questions are still
  managed through the existing browser owner-token flow.
- Reaction deduplication still uses the existing fingerprint contract after
  login; it is not yet one reaction per account.
- Account-based votes and safe anonymous/account duplicate reconciliation are
  a separate future migration/RPC task. This change does not alter vote data.
- OAuth redirects reload the page; no draft persistence is introduced.

Official setup references:
[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao).

For canonical accounts, explicit identity linking, login return paths and
guest-vote reconciliation, see [Auth identity and sign-in flow](auth-identity-flow.md).
