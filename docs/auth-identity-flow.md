# Askio accounts and sign-in flow

## One account, multiple login methods

The canonical account identifier remains `auth.users.id`. `profiles.id` is the
same identifier, not a provider-specific account. Google, Kakao and supported
email login are Supabase Auth identities. Existing accounts, profiles and their
service data are never automatically merged or deleted by Askio.

Supabase's secure automatic identity linking is left intact. Askio does not
compare email strings to merge accounts. Different provider accounts/emails do
not establish that two accounts belong to the same person.

From profile settings, a signed-in person can explicitly attach an available
Google/Kakao login method using `auth.linkIdentity()`, not `signInWithOAuth()`.
The callback checks that the resulting verified account is the account that
started linking. An identity already belonging to another account is a safe
failure, not an account merge. Unlinking and email addition/change are not
provided here.

The login-method list reduces the SDK identity response to supported provider
presence. Provider identifiers, email addresses and identity metadata are not
rendered or included in public profile responses.

## Dashboard setup (manual, never applied by the application)

In Supabase **Authentication → Sign In / Providers**, enable **Allow manual
linking** in the authentication configuration. The connected database tools do
not expose this Auth configuration toggle, so confirm its current setting in
the Dashboard rather than assuming it is enabled.

In **Authentication → URL Configuration**, allow the exact application URLs:

- `https://askio.quest/auth/callback`
- `https://askio.quest/auth/callback/link`
- The same two paths on the localhost origin/port used for testing.

Keep the Site URL and browser origin consistent, including `www` vs non-`www`.
The provider-facing Google/Kakao callback remains the Supabase Auth callback,
not these application URLs. No provider credentials change is required.

## Return path and recent login preference

The current safe same-origin relative path, query and fragment are captured
before leaving the application. A signed HttpOnly `askio_auth_return_to`
cookie lasts at most ten minutes (`SameSite=Lax`, Secure on HTTPS). Login and
linking have distinct fixed callback paths. The cookie is cleared on completion;
missing, expired or invalid link state cannot become a normal login flow.

Only successful authentication can update the browser preference
`askio_last_login_provider`, limited to `google`, `kakao` or `email`. It is a
convenience label, not proof of identity; no email/token is stored in it. Logout
does not clear this preference. Email OTP uses the shared safe return-path
handling, without sending real test emails during automated tests.

## Guest ballot after login

The existing explicit vote-claim request runs before the detail viewer is
accepted. Claiming an unowned guest ballot attaches the verified account to
that **same row**, without changing votes or participants. An existing account
ballot takes precedence; another account's ballot is not transferred.

Public question reading remains available when authentication verification
fails, but an unresolved viewer is not treated as an unvoted person. Detail
and claim responses provide only the safe `viewerIdentityStatus` enum
(`guest`, `account`, `unavailable`). The UI enables voting only after successful
claim/viewer resolution matches its current authentication context. Failure or
cookie/auth disagreement requires a retry, never a second fresh ballot.

Existing selection change, cancellation, browser management and management-token
guards remain in place. No vote RPC or data migration is introduced here.

## Verification and limits

Automated route, component and browser tests use mock Auth/provider responses;
they do not sign into real external accounts, send email or mutate Production.
After deployment, complete Google/Kakao and identity-conflict acceptance tests
with staging/test accounts after enabling manual linking and redirect URLs.

Linking multiple login methods does not prove one physical person has exactly
one account. There is no phone identity verification or verified account merge
feature. Clearing a browser's guest cookie or changing origins also cannot be
used as proof that a prior guest ballot belonged to the returning person.

Official references: [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless).
