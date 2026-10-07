# Guest / account 질문 투표

## 최종 정책

- 읽기와 결과 공개 방식은 그대로입니다.
- 투표·선택 변경·댓글·답글·반응은 로그인 없이 가능합니다.
- 질문 작성은 검증된 계정이 필요합니다.
- 로그인 modal을 투표 전후에 자동으로 열지 않습니다.

비로그인 투표는 동일 브라우저/guest identity의 중복은 막지만,
다른 브라우저·기기·쿠키 삭제까지 동일 인간이라고 완벽하게 판별할 수 없습니다.
따라서 실제 인간 기준의 "1인 1표"를 보장한다고 표현하지 않습니다.

## Identity와 공개 응답

서버가 기존 `askio_guest_id` HttpOnly cookie를 생성/읽고, 기존 `GUEST_ID_SECRET`으로
투표 전용 domain-separated HMAC을 계산합니다. 댓글 hash와는 다른 값이며 raw cookie는
DB에 저장하지 않습니다. body/header의 user ID나 guest hash는 actor로 신뢰하지 않습니다.
계정은 서버의 `getUser()` 검증 결과를 사용합니다. 인증 확인 오류가 있는 요청을 guest로
조용히 강등하지 않습니다.

공개 viewer 상태는 `viewerVote.optionIndex`와 `viewerVote.canChangeVote`만 반환합니다. raw cookie, voter ID,
guest hash, 계정 ID, email, IP는 JSON 또는 analytics로 보내지 않습니다.
viewer 응답은 `private, no-store`입니다. IP는 기존 abuse rate limit에만 사용합니다.
`GUEST_ID_SECRET`을 교체하면 기존 guest hash를 다시 찾을 수 없으므로 안정적으로 유지하세요.

## Ledger와 claim

- account: nullable `user_id`, `(poll_id,user_id)` 부분 UNIQUE.
- guest: nullable `guest_id_hash`, `(poll_id,guest_id_hash)` 부분 UNIQUE.
- legacy: 기존 `voter_id` 및 UNIQUE 유지. 기존 행·집계의 backfill/삭제/재계산 없음.
- fresh 행의 무작위 `voter_id`는 기존 NOT NULL/UUID 제약 호환용이지 공개 identity가 아닙니다.

상세 GET은 account 투표를 먼저, 다음으로 현재 browser hash의 참여를 읽습니다.
로그인 상태의 초기 진입·로그인 전환에서는 POST reconciliation을 완료하고 viewer 상태를
다시 확인합니다. 로그인 전에 고른 option을 새 투표로 자동 제출하지 않습니다.
account 투표가 없으면 소유되지 않은 guest 행, 다음으로 소유되지 않은 legacy 행을 claim합니다.
행 수·votes·participants는 바꾸지 않습니다. guest hash는 claim 후에도 남겨 같은
브라우저가 로그아웃해서 새 투표를 추가하는 것을 막습니다. 이 경우 guest는 선택과
결과를 열람할 수 있으나 account에 연결된 선택 변경에는 원래 계정 로그인이 필요합니다.

현재 account의 투표가 없고 browser 행이 다른 account에 이미 연결됐다면, identity 충돌을
오류로 취급하지 않습니다. 기존 선택을 결과 화면에 표시하고 `canChangeVote=false`로
새 투표/변경을 막습니다. 계정 종류나 다른 account의 ID는 공개하지 않습니다.
claim RPC도 기존 선택을 정상 반환하되 user/hash를 재귀속하지 않으며 집계를 수정하지 않습니다.
현재 account의 자체 투표가 있다면 언제나 그것이 우선하고 `canChangeVote=true`입니다.

account와 guest 투표가 이미 둘 다 존재하면 account 선택을 우선합니다. 과거 두 행을
자동 merge/delete하지 않으며 세 번째 행도 만들지 않습니다. 따라서 이 충돌의 과거
집계가 두 표로 남을 수 있습니다. 단일 account 행에 여러 기기의 모든 guest hash를
연결하는 별도 매핑은 이번 범위가 아닙니다.

Legacy claim의 `voterId`는 기존 브라우저 bearer credential입니다. 기존 계정에 연결된
행이나 다른 guest hash에 연결된 행을 가로채지 않습니다. 유출된 과거 bearer ID가
실제 원래 사람인지 증명할 수는 없습니다.

## 원자성과 선택 변경

모든 신규 RPC는 service-only SECURITY INVOKER, `search_path=pg_catalog`입니다.
poll 행을 먼저 잠그고 ledger를 처리하여 owner 구조 수정·moderation과 lock 순서를
맞춥니다. 동일 actor 동시 요청은 UNIQUE와 poll lock으로 한 행/한 번의 증가만 허용합니다.

선택 변경은 기존 option -1 / 새 option +1이며 participants와 행 수는 유지합니다.
같은 option은 no-op입니다. GET은 DB를 수정하지 않으며 claim은 POST에서만 수행합니다.
상세 GET이 guest cookie를 마련한 뒤 투표를 활성화합니다. 같은 초기 화면의 겹친
GET/claim은 클라이언트에서 공유하고, query·계정·페이지 변경 때도 identity 응답 순서를
직렬화합니다. 늦은 최초 응답의 Set-Cookie가 투표에 사용한 cookie를 덮어쓰지 않도록 합니다.
다른 탭·브라우저의 쿠키가 전혀 없는 동시 최초 요청까지 같은 사람임을 증명할 수는 없습니다.

로그인 modal은 열린 위치의 pathname/query/hash를 안전한 상대 경로로 보관합니다.
Google·Kakao callback과 Email OTP 완료는 동일 위치로 복귀하며 외부 URL, protocol-relative
URL, backslash/control 및 auth/api loop 경로는 거부합니다.

## Migration과 Production

2026-10-07 읽기 전용 재확인 결과, 계정/dual-identity migration은 이미 Production에
적용돼 있습니다. 적용된 두 원본 파일은 변경하지 않습니다.

1. 기존 적용: `20261005142934_add_account_poll_voting.sql`.
2. 기존 적용: `20261006105629_add_dual_identity_poll_voting.sql`.
3. 신규 patch: `20261007005710_fix_vote_identity_reconciliation.sql` — 4인자 claim 함수의
   다른-account browser branch만 정상 read-only 결과로 보정합니다. 반환형/권한은 유지합니다.
4. disposable local/staging DB에서 세 migration과 SQL 테스트를 먼저 검증합니다.
5. 승인 후 Production에 새 patch만 transaction으로 적용하고 코드를 배포합니다.

이번 작업은 Production migration/투표/댓글/Storage mutation을 수행하지 않습니다.
migration history 테이블은 없으므로 전체 `db push`로 모든 과거 파일을 재실행하지 마세요.
기존 dual-identity RPC 자체가 누락되면 API는 안전한 503으로 실패하며 legacy cast로
fallback하지 않습니다. 이 신규 patch가 아직 적용되지 않은 배포의 정확한
`42501/VOTE_REQUIRES_ACCOUNT` claim 충돌은 비공개 ledger 조회로 읽기 전용 결과를 확인합니다.
그 외 권한 오류를 guest identity로 우회하지 않습니다.

2026-10-07 읽기 전용 baseline: polls 100, poll_votes 20, comments 36, reactions 8.
historical aggregate와 ledger 수는 서로 다를 수 있으므로
ledger를 기준으로 집계를 다시 맞추면 안 됩니다.

## 검증

```powershell
node scripts/test-moderation-routes.mjs
node scripts/test-email-auth.mjs
node scripts/test-auth-navigation.mjs
node scripts/test-vote-identity-requests.mjs
node scripts/test-poll-discovery.mjs
node scripts/test-official-statistics.mjs
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

API suite는 mock 기반입니다. 실제 DB lock/concurrency를 증명하지 않습니다.
이번 reconciliation 보정에서 API 회귀 126개, 이메일 OTP/modal navigation mock,
identity 요청 순서 테스트, discovery 9개, 공식 데이터 11개가 통과했습니다.
Production build/start와 기존 Chrome으로 375/390/430/1440px × light/dark에서
guest→account 동일 행 claim, logout→다른 account의 읽기 전용 결과, 현재 account
우선/선택 변경, Email OTP 복귀를 확인했습니다. Google/Kakao의 실제 OAuth 진입 URL도
poll/query/hash를 보존했습니다. 외부 provider 로그인을 완료한 검증은 아닙니다.
쿠키 없는 초기 GET이 겹칠 때 늦은 Set-Cookie가 투표 identity를 바꾸는 경합을
로컬에서 재현하고, 직렬화 후 동일 행/참여자 1명 유지도 확인했습니다.
브라우저 API/Auth mutation은 전부 mock으로 가로챘고 document overflow와 runtime
error는 없었습니다. 이는 과거 Production 방문자의 정확한 실행 순서를 증명하지 않습니다.

이번 작업에서 Production ledger/aggregate checksum과 수량은 작업 전후 동일했습니다.
이번 reconciliation patch의 SQL suite에는 guest→account 동일 행 claim, 다른-account
browser 정상 결과, account precedence 및 타계정 재귀속/세 번째 투표 금지 검증이 추가됐습니다.
로컬 PostgreSQL/Docker가 없어 실제 SQL suite와 두 연결 동시성 테스트는
이번 환경에서 실행하지 않았습니다. API mock 검증과 실제 DB lock 검증은 별개입니다.

`supabase/tests/account_poll_voting.sql`은 명시적인 opt-in과 loopback guard가 있는
disposable local DB 전용 rollback suite입니다. Production에는 rollback 테스트도
실행하지 마세요. SQL suite 및 실제 두 연결의 동시 요청은 별도로 실행해야 합니다.

```powershell
$env:PGOPTIONS = '-c askio_test.account_voting=local-disposable'
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/account_poll_voting.sql '<local disposable DB URL>'
Remove-Item Env:PGOPTIONS
```

동일 guest/account의 동시 cast, claim과 cast, 선택 변경과 owner 구조 수정 경합을
두 연결로 검증하세요. guest 최초 투표/새로고침/변경, login claim, account 충돌,
logout 뒤 claimed ballot 보호, guest 댓글/반응·profile·create·moderation도 확인합니다.

rate limiter는 현재 프로세스 메모리 기반이므로 여러 서버 인스턴스 전체의 전역 제한은
아닙니다. 쿠키 삭제·다른 브라우저·다중 계정까지 완벽하게 막지 못합니다.
분산 rate limit/CAPTCHA는 향후 검토 사항이며 이번에는 추가하지 않습니다.
