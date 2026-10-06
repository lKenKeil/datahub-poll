# 계정 기반 질문 투표: 배포 및 검증

> 이 문서는 로그인 필수 투표를 구현한 시점의 기록입니다. 최종 정책과 배포 지침은
> [guest/account 투표](dual-identity-voting.md)를 따르세요. 이미 적용된 계정 migration은
> 수정하거나 재실행하지 않고 후속 migration으로 확장합니다.

## 정책과 범위

- 읽기와 기존 결과 공개 정책은 유지합니다. 신규 투표와 선택 변경은 검증된 Auth 계정이 필요합니다.
- 댓글/답글/반응의 guest 정책, 프로필, owner credential, discovery와 analytics 이벤트 이름은 변경하지 않습니다.
- API는 `getUser()`로 검증한 계정 ID만 서버 전용 RPC에 전달합니다. body/header의 user ID는 신뢰하지 않습니다.
- 공개 응답은 자기 선택의 `viewerVote.optionIndex`만 전달하며 ledger 계정/브라우저 ID를 전달하지 않습니다.

## Migration

`supabase/migrations/20261005142934_add_account_poll_voting.sql`

- nullable `poll_votes.user_id`와 Auth FK `ON DELETE SET NULL`을 추가합니다.
- `(poll_id, user_id) WHERE user_id IS NOT NULL` partial unique로 계정당 질문당 한 행을 보장합니다.
- 기존 `voter_id`와 unique, anonymous rows, 기존 RPC 및 aggregate를 그대로 둡니다. backfill/삭제/재계산은 없습니다.
- 신규 RPC는 service-only SECURITY INVOKER입니다. 서버의 verified user ID와 FK를 사용하고 public execute/raw ledger 접근을 허용하지 않습니다.
- 서비스 역할에 ledger의 필요한 INSERT/UPDATE 컬럼과 sequence USAGE만 추가합니다. 기존 owner reset용 DELETE는 유지합니다.
- 동일 질문 행을 먼저 `FOR UPDATE`하므로 신규 투표/변경/claim/owner 구조 수정이 같은 lock boundary를 공유합니다.
- migration은 정상적인 재실행을 허용하지만 기존 컬럼/FK/index 정의가 다르면 안전하게 중단합니다.

## Legacy claim과 충돌

`POST /api/polls/{id}/vote/claim`은 로그인된 사용자가 기존 브라우저 `dh_voter_id`를 가진 경우에만 호출합니다.
소유되지 않은 기존 행에 user ID를 연결할 뿐, 행 생성이나 집계 변경은 하지 않습니다. GET은 읽기 전용입니다.

이미 계정 투표가 있으면 해당 선택이 우선하며 legacy historical row는 삭제/merge하지 않습니다.
두 과거 행의 집계가 남을 수 있는 one-time limitation을 허용합니다. 이를 자동 재계산하지 않습니다.
로그아웃 브라우저는 아직 claim되지 않은 legacy 결과만 기존 ID로 볼 수 있고 새 투표/변경은 불가능합니다.
이 ID는 과거의 익명 bearer identifier이므로 유출/공유된 ID가 원래 사람임을 증명하지 못합니다.
claim 기간 종료와 historical 결과 접근 정책을 별도로 결정하기 전에는 storage helper/기존 RPC를 제거하지 않습니다.

새 계정 행의 무작위 `voter_id`는 기존 NOT NULL/unique 호환용 서버 값일 뿐이며 identity로 사용하거나 공개하지 않습니다.
계정 삭제는 ledger와 집계를 보존하도록 user ID만 NULL로 바꿉니다. 여러 계정을 만든 동일인의 투표까지 막지는 않습니다.

## 적용 순서와 실제 확인 상태

2026-10-05 Production **읽기 전용** 확인에서는 다음 선행 기능이 이미 존재했습니다:
profiles, comments.user_id, guest_id_hash, change_profile_avatar. poll_votes.user_id는 아직 없었습니다.
Supabase migration history 조회는 빈 배열이므로 파일별 적용 여부를 history만으로 확정할 수 없습니다.
아래는 의존 순서이지, 전부 무조건 재실행할 목록이 아닙니다.

1. `20261004140201_add_authenticated_comments.sql`
2. `20261004155055_add_user_profiles_and_authorship.sql`
3. `20261005032546_add_guest_comments_and_avatar_privacy.sql`
4. `20261005045312_profile_avatars_and_guest_reactions.sql`
5. `20261005142934_add_account_poll_voting.sql`

선행 파일의 실제 컬럼/함수/정책/권한을 Dashboard에서 대조한 뒤 **빠진 단계만** 적용하세요.
이미 적용된 선행 파일은 constraint/policy 재생성 때문에 무작정 재실행하면 안 됩니다.
과거 migration을 새 계정 투표 migration 뒤에 실행하면 권한/투표 정책이 역전될 수 있습니다.

새 migration을 staging 또는 로컬 disposable DB에서 먼저 검증하고, Production에서는 transaction으로
새 migration을 먼저 적용한 다음 코드를 배포합니다. 새 nullable 컬럼과 기존 RPC 유지로 구버전 코드는 호환됩니다.
다만 code 전환 전까지 구버전 배포는 익명 투표를 계속 허용하므로 그 구간은 짧게 유지해야 합니다.
새 코드부터 배포하면 schema/RPC 누락 시 503으로 실패하며 익명 투표로 fallback하지 않습니다.
DB migration과 code 배포 모두 **이번 작업에서는 수행하지 않았습니다**.

적용 전후 polls 수, ledger 행 수, participants 합, 옵션 votes 합을 비교하세요.
historical aggregate가 ledger 행 수와 다르므로 ledger 기준으로 수치를 맞추면 안 됩니다.

## 환경 체크리스트

신규 env는 없습니다. 값/토큰을 출력하지 말고 존재와 설정만 확인하세요.

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 동일 프로젝트의 public Auth client.
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 전용, public 변수로 복제 금지.
- `ADMIN_DASHBOARD_KEY`, `GUEST_ID_SECRET`: 기존 운영/guest 기능에 필요.
- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`: 기존 선택적 analytics.
- `NEXT_PUBLIC_VERCEL_ENV=production`: Production analytics 구분; Preview/development 전송 금지.
- `SITE_URL` 또는 `NEXT_PUBLIC_SITE_URL`: 명시적 사이트 URL. 미설정 시 기존 `VERCEL_PROJECT_PRODUCTION_URL` /
  `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` / `NEXT_PUBLIC_VERCEL_URL` fallback을 사용합니다.
  Supabase Site URL/허용 OAuth callback도 실제 배포 도메인과 일치해야 합니다.

로컬에는 Supabase/관리자/guest 변수 이름이 확인됐습니다. PostHog public 변수는 없었으며 analytics는 선택적입니다.
Vercel Production env 값/존재 여부는 이번 작업에서 원격 조회하거나 변경하지 않았습니다.

## 검증과 제한

읽기 전용 Production baseline: polls 100, seed 90, poll_votes 18, participants 합 4259,
옵션 votes 합 2161, comments 36, reactions 7. 이 작업은 Production 데이터/Storage를 변경하지 않습니다.

API 회귀:

```powershell
node scripts/test-moderation-routes.mjs
node scripts/test-email-auth.mjs
node scripts/test-poll-discovery.mjs
node scripts/test-official-statistics.mjs
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

API suite는 mock 기반이며 실제 DB lock/concurrency를 증명하지 않습니다.
로컬 PostgreSQL/Docker가 없는 실행 환경에서는 아래 SQL suite와 실제 2-connection 테스트는 미실행입니다.
로컬 production build/start에서는 guest 선택→기존 Google/Kakao/Email dialog 표시와
비로그인 POST/PATCH 401을 확인했습니다. 실제 인증/투표/이메일 발송은 하지 않았습니다.

`supabase/tests/account_poll_voting.sql`은 **로컬 disposable DB 전용** rollback suite입니다.
명시적 설정과 loopback guard가 있으며 Production에는 rollback 테스트라도 실행하지 마세요.
sequence와 외부 Auth hooks는 rollback만으로 복원되지 않을 수 있습니다.

```powershell
$env:PGOPTIONS = '-c askio_test.account_voting=local-disposable'
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/account_poll_voting.sql '<local disposable DB URL>'
Remove-Item Env:PGOPTIONS
```

SQL suite는 FK/unique/권한, claim/충돌, 선택 변경/no-op, 실패 rollback, 계정 삭제 보존을 검사합니다.
별도 두 연결로 동일 계정/질문 cast를 겹쳐 실행해 성공 1회/중복 1회,
ledger 1행/aggregate +1/participants +1을 확인하세요. claim/cast와 owner 구조 수정 경합도 확인하세요.

배포 후 수동 smoke: guest 선택→기존 로그인 dialog, 로그인 복귀(자동 투표 없음),
첫 투표→결과, 다른 브라우저 같은 계정→같은 선택, 중복 POST 409, PATCH 변경/no-op,
legacy claim 집계 불변, 계정/legacy 충돌 보존, guest 댓글/반응 및 owner 기능 회귀.
Google/Kakao/Email은 provider별 투표 분기를 갖지 않습니다. 실제 OAuth/OTP 인증과 수신은 별도 수동 확인입니다.

## 이후 순서 (이번 작업에 포함하지 않음)

필요한 pending migration 적용 → env 확인 → push/deploy → Production smoke →
`/privacy`와 `/terms` 작성 → Google/Kakao 정책 URL 등록 → 외부 유입 시작.
