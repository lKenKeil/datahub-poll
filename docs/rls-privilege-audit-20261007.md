# Askio RLS / privilege audit — 2026-10-07

## Scope and result

Production project: `ckacekbnzfuoiazicxil` (the configured Askio Supabase URL).
All Production operations in this audit were read-only catalog/count/digest queries,
migration-history lookup and security-advisor lookup. No Production fixtures,
transactional writes, DDL, migration application or push were performed.

Production counts before/after: polls 100 (seed 90), poll_votes 21,
comments 36, reactions 8, profiles 2, Auth users 2. Counts and both tables'
policy definitions were identical on the final read-only recheck. Full-row
aggregate digests of polls, comments, votes, reactions, profiles, reports and
ownership also remained identical; no raw identity/content values were exported.

The exact legacy policies are redundant for current reads and server writes.
Remove **only** `polls_full_access` and `comments_full_access` with
[`20261007071731_remove_legacy_full_access_policies.sql`](../supabase/migrations/20261007071731_remove_legacy_full_access_policies.sql).
This does not change grants, functions, triggers, table structure, application logic or data.

## Live Production policies (before removal)

Both tables: owner `postgres`, RLS enabled, FORCE RLS disabled.

| Table | Policy | Kind | Command | Roles | USING | WITH CHECK |
| --- | --- | --- | --- | --- | --- | --- |
| polls | polls_full_access | permissive | ALL | PUBLIC | true | true |
| polls | Public read polls | permissive | SELECT | anon, authenticated | not is_hidden | absent |
| polls | Moderation public poll visibility | restrictive | SELECT | anon, authenticated | not is_hidden | absent |
| comments | comments_full_access | permissive | ALL | PUBLIC | true | true |
| comments | Public read comments | permissive | SELECT | anon, authenticated | not is_hidden AND visible parent poll exists | absent |
| comments | Moderation public comment visibility | restrictive | SELECT | anon, authenticated | not is_hidden AND visible parent poll exists | absent |

Both comment SELECT predicates use:
```sql
not is_hidden and exists (
  select 1 from public.polls p
  where p.id = comments.poll_id and not p.is_hidden
)
```

A visible reply to a hidden comment remains visible; the API provides a
content-free parent placeholder. Hiding the poll suppresses all its comments.
These established behaviors are not changed.

Permission gates and policy semantics are described in the
[Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Effective privileges

`anon` and `authenticated`:
- No whole-table SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER
  on polls/comments.
- No column INSERT/UPDATE/REFERENCES; SELECT is an explicit column allowlist.
- No PUBLIC table/column ACL on either target table; no inherited role memberships
  were found for these roles.
- No raw access to poll_votes, poll_ownership, content_reports or comment_reactions.
- Authenticated profiles retain own-row SELECT and column UPDATE for nickname,
  onboarding_completed and show_avatar, with the existing own-row RLS boundary.
  These intended profile permissions are separate from polls/comments.

Public poll SELECT columns:
`id, title, category, options, votes, participants, created_at, official_fact,
option_image_paths, edit_lock_mode, edit_lock_minutes, edit_lock_participants,
is_hidden, hidden_at, is_anonymous`.
`author_user_id` is denied.

Public comment SELECT columns:
`id, poll_id, user_name, text, created_at, parent_id, is_hidden, hidden_at,
is_anonymous, anonymous_alias`.
`user_id` and `guest_id_hash` are denied. API projections also omit
`hidden_at`. Direct SELECT * is intentionally denied because of private columns.

`service_role`: not a superuser; BYPASSRLS true. Existing full table privileges
on polls/comments include SELECT/INSERT/UPDATE/DELETE and maintenance privileges.
No service-role permissions are expanded by this change.
On poll_votes it has table SELECT/DELETE and narrow INSERT/UPDATE column grants,
not whole-table INSERT/UPDATE. This is sufficient for current invoker vote RPCs.

## Live public RPC permissions

All entries deny EXECUTE to PUBLIC, anon and authenticated. Trigger functions
are included for completeness. Current mutation entry points are invokers and
run through an isolated server service-role client after application authorization.

| Signature | Security mode | service_role EXECUTE | public/anon/authenticated EXECUTE |
| --- | --- | --- | --- |
| `cast_authenticated_poll_vote(text,integer,uuid,text)` | INVOKER | yes | no |
| `cast_authenticated_poll_vote(text,integer,uuid)` | INVOKER | yes | no |
| `cast_guest_poll_vote(text,integer,text)` | INVOKER | yes | no |
| `change_authenticated_poll_vote(text,integer,uuid)` | INVOKER | yes | no |
| `change_guest_poll_vote(text,integer,text)` | INVOKER | yes | no |
| `change_poll_vote(text,integer,text)` | DEFINER | yes | no |
| `change_profile_avatar(uuid,text,text,text,text)` | INVOKER | yes | no |
| `claim_authenticated_poll_vote(text,text,uuid,text)` | INVOKER | yes | no |
| `claim_authenticated_poll_vote(text,text,uuid)` | INVOKER | yes | no |
| `claim_guest_poll_vote(text,text,text)` | INVOKER | yes | no |
| `create_comment_with_identity(text,text,text,uuid,text,boolean,text,text)` | INVOKER | yes | no |
| `create_owned_poll(text,text,text,jsonb,jsonb,integer,text,jsonb,text)` | INVOKER | yes | no |
| `create_owned_poll(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer)` | INVOKER | yes | no |
| `create_owned_poll_with_author(text,text,text,jsonb,jsonb,integer,text,jsonb,text,text,integer,integer,uuid,boolean)` | INVOKER | yes | no |
| `delete_comment_with_dependents(uuid)` | INVOKER | yes | no |
| `delete_poll_with_dependents(text)` | INVOKER | yes | no |
| `ensure_user_profile(uuid)` | INVOKER | yes | no |
| `get_content_report_queue(text,integer,integer)` | INVOKER | yes | no |
| `increment_poll_vote(text,integer,text)` | DEFINER | yes | no |
| `increment_poll_vote(text,integer,text,text,text[],integer[],integer)` | DEFINER | no | no |
| `increment_poll_vote(text,integer)` | DEFINER | no | no |
| `lock_poll_for_comment_write()` | INVOKER | yes | no |
| `moderate_report_target(text,text,text)` | INVOKER | yes | no |
| `poll_structural_edit_lock_reason(text,timestamp with time zone,integer,integer,integer,boolean,boolean,timestamp with time zone)` | INVOKER | yes | no |
| `recommend_user_profile_nickname(uuid)` | INVOKER | yes | no |
| `set_comment_reaction(uuid,text,text)` | INVOKER | yes | no |
| `submit_content_report(text,text,text,text,text)` | INVOKER | yes | no |
| `sync_seed_poll_content(text,text,text,jsonb,text,text,integer,integer)` | INVOKER | yes | no |
| `toggle_comment_reaction_with_actor(uuid,text,text)` | INVOKER | yes | no |
| `update_owned_poll(text,text,text,jsonb,text,jsonb,jsonb)` | INVOKER | yes | no |

Private schema `askio_private` is not usable by anon/authenticated.
Profile initialization uses a fixed-search-path definer helper; it does not
depend on either legacy policy. Existing anonymous-name/comment-lock triggers
remain unchanged.

Legacy increment/change vote definers remain non-public. The two-argument and
seven-argument increment overloads also deny service_role EXECUTE. The unused
seven-argument overload still lacks a fixed search_path; leave it for a separate
targeted cleanup rather than silently changing it in this two-policy migration.

## Call-path compatibility

- Public home/detail/metadata and Realtime use the shared anon client; Auth
  verification uses separate cookie-aware clients.
- Visible reads retain their existing permissive SELECT policies and restrictive
  moderation policies.
- Create, owner update/delete, comment/reply, reactions, reports and admin
  moderation use server service_role clients and service-only RPCs.
- Service role bypasses RLS; dropping PUBLIC ALL policies cannot revoke its
  table grants or function EXECUTE.
- Guest/account vote and claim/change paths keep their RPC guards, ledger column
  grants and hidden-target checks.
- Hidden responses keep their final visibility recheck and identity redaction;
  direct public rows cannot read the private identity columns.
- No UI, ranking, API, vote schema, voter identity, Auth or owner/edit-lock changes.

## Storage and history

The two public buckets remain unchanged:
- poll-option-images: 2 MiB, JPEG/PNG/WebP.
- profile-avatars: 2 MiB, WebP.

The existing restrictive `Avatar server writes only` policy remains. Removing
poll/comment RLS policies does not change Storage ACLs or public-URL behavior.
A known public image URL is not revoked by hiding its parent; final deletion
continues to use server cleanup.

The migration-history API returned an empty list despite the live schema and
RPCs being present. Do **not** blindly run all repository migrations or use an
unreconciled whole-project db push to apply this file.

## Tests

Executed against a disposable **in-memory PostgreSQL 17.5 / PGlite** engine:
- Recreated the live public table definitions, constraints, indexes, sequence
  permissions, policies, function bodies/ACLs and triggers from schema-only
  catalog data. No Production rows, emails, tokens or Storage objects copied.
- Auth users/JWT helpers were minimal local fixtures; this is not a hosted
  Supabase Auth/PostgREST/Realtime integration environment.
- Applied only the new two-DROP migration inside that engine.
- [legacy_full_access_policies.sql](../supabase/tests/legacy_full_access_policies.sql):
  retained RLS/read policies; both API roles can read visible rows; hidden
  comments/polls unavailable; private columns/reports unavailable; raw own/other
  row mutations and private RPC invocations denied; service creation/owner edit,
  guest/account comments/replies/reactions, reports, hide/restore and deletion pass.
- [account_poll_voting.sql](../supabase/tests/account_poll_voting.sql):
  existing dual-identity/account/guest/claim/change/rollback and ACL suite passes.
- All fixture rows and fake Auth users rolled back. Engine destroyed afterward.
- No real multi-connection concurrency, browser OAuth, email, Storage network or
  hosted PostgREST tests were claimed.

Existing mock/pure regression commands:
```text
node scripts/test-moderation-routes.mjs       # 126 API checks, including profile/avatar/me/Auth/privacy
node scripts/test-vote-identity-requests.mjs
node scripts/test-email-auth.mjs
node scripts/test-auth-navigation.mjs
node scripts/test-official-statistics.mjs    # 11 checks
node scripts/test-poll-discovery.mjs         # 9 checks; opt-in Production test skipped
node scripts/test-service-policies.mjs
```
All passed. Mock route checks do not replace the SQL role tests above.

Static checks passed: npm run lint, npx tsc --noEmit, npm run build,
git diff --check. No service dependency or package-lock change; the temporary
engine/catalog runner and CLI scratch file were removed before final staging.

The older content_moderation.sql suite is not used unchanged: its public raw
reaction SELECT predates the later reaction SELECT revocation. It has no
local-only guard and must never be run on Production even with ROLLBACK.

## Manual Production application

1. Recheck the four named visible SELECT/moderation policies, both RLS flags,
   public column allowlists and service-role BYPASSRLS/grants.
2. Execute **only** the new migration file in the approved Production SQL workflow.
   It drops the two named permissive policies, using IF EXISTS for safe reapplication.
   No table, row, grant or RPC is modified.
3. Confirm exactly the four existing SELECT policies remain. Confirm grants and
   RPC ACLs are unchanged.
4. Read-only smoke-check public home/detail/comment reads and unavailable hidden
   content. Use a disposable environment for mutation smoke tests.
5. Reconcile migration history separately after auditing existing applied SQL;
   never infer missing schema from empty history.

## Remaining security considerations

- Current raw mutation grants prevent an immediate client write vulnerability.
  Legacy PUBLIC ALL policies nevertheless bypass a write-policy boundary if a
  future migration accidentally grants client writes. After removal there is
  no public permissive write policy, so RLS adds default-deny defense in depth.
- service_role bypasses RLS by design: server authorization, hidden-target checks,
  secret isolation and narrow RPC EXECUTE remain essential.
- Live default privileges are broad for newly created public tables/functions.
  Every future migration still needs explicit REVOKE/GRANT and RLS review.
- No-policy warnings for private server-only reports/ownership/vote tables are
  consistent with deliberate default deny, not a reason to grant public access.
- Advisor GraphQL visibility warnings include intentional public poll/comment/
  official-data reads and authenticated own-profile reads. Exposure alone does
  not override row/column grants or RLS.
- Advisor leaked-password protection warning is separate; current Email OTP
  does not store an app password. Do not claim an Auth Dashboard fix here.
- Public Storage URLs and migration-history reconciliation remain operational
  follow-ups, not changes in this migration.
