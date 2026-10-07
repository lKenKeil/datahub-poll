# 브라우저 참여 투표 변경·취소

## 정책과 데이터 안전

- 서버가 검증한 Auth 계정의 표를 우선하고, 없으면 HttpOnly `askio_guest_id`의 투표 전용 HMAC에 연결된 표를 관리합니다.
- 브라우저 연결 표는 다른 계정에 연결되어 있어도 변경·취소 가능합니다. 기존 `user_id`, `guest_id_hash`, `voter_id`는 변경·재귀속하지 않습니다.
- 계정 표와 다른 계정의 브라우저 표가 함께 있으면 계정 표 하나만 관리합니다. 취소 후 남은 브라우저 표가 viewer로 나타날 수 있으나 자동 변경·삭제·병합하지 않습니다.
- 취소된 브라우저 표는 원래 연결 계정에서도 사라집니다. 같은 쿠키를 공유하는 사람이 표를 관리할 수 있는 의도된 tradeoff입니다. 다른 브라우저·쿠키 삭제까지 같은 인간임을 판별하지 못합니다.
- legacy header-only 표는 기존 안전한 claim 이전에 관리하지 않습니다. historical aggregate 재계산/backfill은 하지 않습니다.

## API와 경합 방어

`viewerVote`는 `optionIndex`, `canChangeVote`, `canCancelVote` 및 관리 가능한 표의 `managementToken`만 제공합니다. 토큰은 서버 HMAC digest이며 row/account/guest ID를 포함하거나 인코딩하지 않습니다. 메모리에만 보관하며 analytics로 보내지 않습니다.

- POST: 기존 신규 투표 경로 유지.
- PATCH: `{ optionIndex, managementToken }`으로 기존 한 표 변경.
- DELETE: `{ managementToken }`으로 기존 한 표 취소. `data.viewerVote`는 nullable이며 취소 후 남은 viewer를 표현합니다.
- 서버는 클라이언트의 user ID/guest hash/ledger ID를 신뢰하지 않습니다. 현재 proof로 조회한 row와 토큰을 비교하고, 서버에서 읽은 `p_expected_vote_id`만 RPC에 전달합니다.
- RPC는 poll → selected ledger 순으로 잠그고 account-first 선택과 expected ID를 다시 검증합니다. 이중 취소, 다른 표로 대상 이동, cancel/recast ABA는 `VOTE_MANAGEMENT_CONFLICT`로 실패합니다.
- 변경은 기존 option -1 / 새 option +1, 취소는 해당 option -1 / participants -1 / row DELETE입니다. 잘못된 집계는 보정·clamp하지 않고 실패하며 전부 rollback합니다.
- 응답은 private/no-store이고 DB 상세 오류·다른 계정 정보는 공개하지 않습니다. 결과·투표 성공 analytics는 기존 범위를 유지하며 취소 이벤트는 추가하지 않습니다.

## 적용 순서

이미 적용된 account, dual-identity, reconciliation migration은 수정하지 않습니다. 새 파일:

`supabase/migrations/20261007090452_add_vote_cancellation_and_browser_management.sql`

운영자가 후속 파일만 먼저 적용한 뒤 코드 배포가 필요합니다. 새 RPC 누락 시 API는 안전한 503으로 실패합니다. migration history가 일치하지 않는 환경에서 전체 과거 migration을 일괄 재실행하지 마세요. 이번 구현 세션은 Production DB mutation/migration/push를 수행하지 않습니다.

## 검증

`node scripts/test-moderation-routes.mjs`는 API 계약 mock이고 실제 DB locking 검증과 별개입니다. `supabase/tests/vote_management.sql`은 로컬 disposable DB에서 명시적으로 `askio_test.vote_management=local-disposable` 설정 후에만 실행합니다. Production에는 rollback 테스트도 실행하지 마세요.

실제 두 연결 검증은 `scripts/test-vote-management-concurrency.mjs`를 이용합니다. node-postgres driver가 있는 독립 로컬 PostgreSQL에서 위 migration과 기존 기반 schema를 준비하고 실행하세요. 실행 DB 이름은 반드시 `askio_vote_management_disposable`, host는 loopback이어야 하며 .env를 읽지 않습니다.

```powershell
node scripts/test-vote-management-concurrency.mjs --local-disposable-url='postgresql://postgres:LOCAL_TEST_PASSWORD@127.0.0.1:5432/askio_vote_management_disposable' --pg-module='C:/local-test-tools/node_modules/pg/lib/index.js'
```

2026-10-07 검증: 기존 Production schema/privilege 정의만 복제한 별도 PostgreSQL 17.6에서 sequential SQL suite 및 실제 Lock 대기 경합 20회 통과. provider 순서 양방향, guest/account/다른-account browser 표 취소, 재투표, 계정 충돌, stale/ABA, 음수·malformed 집계, 중간 오류 rollback과 public 권한 거부를 확인했습니다. 테스트 종료 후 fixture poll 0개입니다.

Production build/start + API mock으로 375/390/430/1440px × light/dark 8조합의 변경→취소→재투표, 44px controls, keyboard confirmation, document overflow 0을 확인했습니다. 성공한 POST/PATCH 뒤 다른 탭의 취소로 viewer가 사라지는 UI 경합 2개도 최신 미참여 상태로 안전하게 복구됐습니다. 외부 OAuth 계정 로그인 완료나 Production에 실제 투표를 남기는 검증은 하지 않았습니다.
