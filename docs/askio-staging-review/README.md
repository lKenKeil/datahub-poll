# ASKIO 스테이징 스키마 재현 검토안

기준은 GitHub [Draft PR #1](https://github.com/lKenKeil/datahub-poll/pull/1)의 `4cb6ae3`입니다. 대상은 `askio-staging` (`xfskekmcmwjvuqbthdue`)입니다. 운영 `ckacekbnzfuoiazicxil`은 스키마 비교에만 사용합니다. 이 패키지는 적용 승인 전 검토용입니다.

## 재현 판정과 운영·스테이징 증거

**적용 보류.** 제공받은 운영 인벤토리와 저장소 계약을 비교했지만 실제 운영의 전체 정의를 아직 받지 못했습니다. `00-app-baseline.sql`은 생성하지 않았습니다. 이 작업 환경에는 운영 프로젝트의 공개 URL·키만 있으며, 연결된 ChatGPT의 SQL 조회나 스테이징 관리자 연결은 사용할 수 없습니다. 이 폴더의 SQL과 문서는 별도 검토 브랜치에 보관합니다.

| 대상 | 제공받은 확인 결과 | 대조 결과와 남은 증거 |
| --- | --- | --- |
| 앱 테이블 / 루틴 | 운영 public 테이블 10개 모두 RLS 활성, public·askio_private 앱 함수 37개. 스테이징 앱 객체 0개. | 이전 로컬 비교와 개수 일치. 최초 `polls`·`comments` DDL이 저장소에 없어 운영 열·제약·기본값·인덱스 정의를 확보해야 합니다. 함수별 본문, 소유자, SECURITY/검색 경로, ACL도 필요합니다. |
| public RLS | 운영 12개. 스테이징 앱 정책 없음. | 저장소의 공식 계정 직전 상태를 재현한 로컬 비교는 11개입니다. 개수만으로 빠진 정책인지 추가 정책인지 식별할 수 없습니다. 실제 정책 이름·대상 역할·명령·조건을 대조해 차이를 승인해야 합니다. 과거 감사의 legacy ALL 정책과 연관이 있는지도 현재 정의로 확인합니다. |
| 앱 트리거 / Realtime | 운영 4개 트리거와 `polls`, `comments`, `comment_reactions` Realtime 등록. 스테이징은 기본 시스템 트리거만 있음. | 이름·대상은 저장소와 일치합니다. 실제 트리거 본문·바인딩·활성 상태 및 publication의 컬럼 목록·행 필터는 원본 추출 후 비교합니다. |
| 권한 / 공식 계정 선행 조건 | 운영 반응 직접 SELECT 금지. 서비스 역할 소유권 SELECT/UPDATE, 토큰 해시 NOT NULL, 작성자 SET NULL, 소유권 CASCADE, 기존 작성자 RPC 존재. 공식 등록부·새 RPC 미적용. | 주어진 계약은 03·04와 일치합니다. 관련 열 수준 grant, FK의 정확한 양쪽 컬럼·유효성, RPC 내부 흐름과 ACL을 현재 운영 원본으로 검증해야 합니다. |
| Storage / 이력 | 운영 버킷 두 개, 스테이징 버킷 없음. 운영 `supabase_migrations.schema_migrations` 없음. | 버킷 구성은 02와 일치합니다. `storage.objects`의 실제 정책·ACL은 미확인입니다. 이력 부재와 버전 접두사 중복을 이유로 적용 이력을 추정하거나 전체 migration을 실행하지 않습니다. |

이전 공개 API 리허설은 운영의 공개 투표·댓글·통계 컬럼 조회와 작성자·소유권 경계를 확인한 증거입니다. 현재 보고의 운영 비공개 구조는 사용자가 제공한 인벤토리에 근거합니다. 아래 [기준선 확정 계약](baseline-contract.md)은 실제 SQL과 대조하는 방법을 규정합니다.

## 구조 대조표

| 영역 | 저장소 계약과 확인할 차이 |
| --- | --- |
| 투표·댓글 | `polls`, `comments` 최초 DDL은 운영 카탈로그에서 확인합니다. 투표 ID text, 선택지·집계 JSONB, 댓글 ID 및 부모 참조의 실제 타입·기본값·FK를 확인합니다. 공개 열 allowlist, 숨김된 투표·댓글의 SELECT 정책, UUID·게스트 해시 차단을 유지합니다. |
| 투표·소유권 | `poll_votes`, `poll_ownership`, 고유 제약, identity 시퀀스 및 세분화된 서비스 역할 권한을 확인합니다. `create_owned_poll_with_author`의 토큰 기록 후 작성자 업데이트 순서, 생성·수정·삭제 RPC 및 게스트/로그인 cast·claim·change·cancel RPC의 본문·시그니처·권한을 비교합니다. |
| Auth·프로필·모더레이션 | Supabase가 준비한 `auth.users`, `auth.uid()`, `auth.jwt()`를 사용합니다. `profiles`의 가입 트리거, 본인 행 정책, `askio_private` 권한, 댓글 익명화와 행 잠금 트리거, `comment_reactions`, `content_reports`, `deleted_official_polls`를 확인합니다. 공개 raw 반응 조회는 차단하고 API의 집계 응답을 확인합니다. |
| 공식 통계·Realtime | `official_sources`, `official_statistics`는 테이블·권한을 재현합니다. 앱 테스트에 필요한 통계가 있으면 합성 레코드를 별도로 만듭니다. `supabase_realtime`에 필요한 공개 테이블과 컬럼 경계를 확인하고 비공개 프로필·투표 원장·소유권·공식 계정 등록부를 추가하지 않습니다. |
| Storage | `poll-option-images`는 공개 URL, 2 MiB, JPEG/PNG/WebP. `profile-avatars`는 공개 URL, 2 MiB, WebP. 아바타 정책은 저장소에 정의되어 있습니다. 운영 투표 이미지의 정확한 객체 정책은 최신 카탈로그 대조 대상입니다. 02는 조회만 수행합니다. 비교를 마친 실제 앱 정책만 별도 승인으로 설치하며, Supabase 관리 URL의 공개 읽기와 서버 서비스 역할 업로드·삭제를 스테이징에서 별도 확인합니다. 기존 객체·파일은 복사하지 않습니다. |

## 적용 후보와 순서

1. **양쪽 메타데이터 수집.** 프로젝트 식별자를 확인한 뒤 [00-exact-definition-export.sql](00-exact-definition-export.sql)과 [01-schema-inventory.sql](01-schema-inventory.sql)을 각 프로젝트에서 따로 실행합니다. 읽기 전용 트랜잭션에서 스키마 카탈로그와 지정 버킷 설정만 조회합니다. migration 등록부가 있으면 버전만 별도로 조회합니다. 함수 본문은 권한이 확인된 읽기 전용 연결에서 필요한 앱 스키마만 `pg_dump --schema-only --schema=public --schema=askio_private`로 추출해 검토합니다. DB 접속 정보는 승인된 보안 설정에 둡니다. 덤프를 그대로 복원하지 않습니다. 소유자·기본 ACL·확장·플랫폼 의존성·하드코딩된 설정을 검토하고, 해당 앱의 `auth.users` 트리거, `storage.objects` 정책, Realtime 항목은 메타데이터에서 따로 확인합니다. `auth`·`storage` 전체 스키마, 관리 역할과 계정·데이터·파일은 복원 대상에서 제외합니다.
2. **기준선 확정.** 대조 결과를 근거로 리뷰 가능한 앱 전용 `00-app-baseline.sql`을 작성합니다. 새 스테이징의 Supabase 관리 객체·UUID 함수·기본 권한·publication을 먼저 확인한 뒤 테이블과 시퀀스, 함수와 트리거, RLS·권한, 앱의 Realtime 등록을 의존성 순서로 준비합니다. 이 패키지에는 현재 운영 DDL이 확인되지 않아 기준선 파일이 없습니다. 스키마가 이미 존재하면 기준선 재설치 대신 차이만 검토합니다.
3. **저장소 이력의 역할.** [파일 인벤토리](repository-migration-inventory.txt)는 비교용입니다. 초기 구조/권한 → 소유권·수정 잠금 → 모더레이션 → Auth·프로필/게스트/아바타 → 계정·이중 식별/투표 변경·취소 → 공식 계정 순으로 대조합니다. 검토한 최종 상태 기준선을 적용한 뒤 과거 SQL 전체를 다시 실행하지 않습니다. 동일 날짜 접두사, 초기 공개 쓰기 권한, 재실행 불가 DDL이 있으므로 `supabase db push` 일괄 실행은 사용하지 않습니다. 스테이징에서 저장소의 seed SQL은 건너뛰고 합성 데이터를 별도 사용합니다.
4. **Storage.** 승인된 적용 단계에서 빈 버킷 두 개를 스테이징 Dashboard/API로 준비하고, 원본이 확인된 앱 전용 정책을 기준선과 함께 검토합니다. [02-staging-storage-candidate.sql](02-staging-storage-candidate.sql)은 이름을 유지한 읽기 전용 점검입니다. 이전 검토본에서 제안한 신규 제한 정책 DDL은 현재 운영 정의가 확인될 때까지 제외했습니다.
5. **공식 계정.** [03-before-official-readonly.sql](03-before-official-readonly.sql)로 기존 소유권·Auth 트리거·RPC·권한·Realtime 전제를 확인합니다. 의존성이나 이름 충돌이 있으면 여기서 멈춥니다. 승인 후에만 [04-official-poll-management.sql](04-official-poll-management.sql)을 적용하고 [05-after-official-readonly.sql](05-after-official-readonly.sql)로 확인합니다. 04는 `4cb6ae3` 원본과 동일하며 SHA-256은 `1662c05b8fdecf5d67f98970de311c32b4a3c49aebb7501ba756ab0a963355df`입니다. 승인 전에는 스테이징에서도 계정 등록과 토큰 전환을 하지 않습니다. 공식 publisher는 스테이징 OTP로 가입한 별도 계정의 UUID를 확인한 뒤 승인된 테스트 담당자가 등록합니다.

## Vercel Preview와 Auth

| 변수 | 범위와 값 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 기능 브랜치의 Preview 범위에 `https://xfskekmcmwjvuqbthdue.supabase.co`를 지정합니다. 빌드에 포함됩니다. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 동일한 스테이징 프로젝트의 공개 키입니다. Preview를 다시 빌드해야 반영됩니다. |
| `SUPABASE_SERVICE_ROLE_KEY` | 스테이징 서비스 역할 키만 서버 전용으로 저장합니다. Production 값은 재사용하지 않습니다. |
| `GUEST_ID_SECRET` | 별도로 생성한 스테이징 서버 비밀을 사용합니다. 32자 이상의 무작위 값으로 준비합니다. |
| `SITE_URL` | 확정한 Preview 호스트만 지정합니다. 관리자 검증이 포함되면 별도 스테이징 `ADMIN_DASHBOARD_KEY`를 준비합니다. |

Preview에 프로덕션 변수가 섞이지 않도록 브랜치 범위를 확인하고, 첫 변경 요청 전에 `/api/health/supabase`의 호스트와 정상 응답을 대조합니다. 공식 계정 UUID를 환경변수에 넣는 이전 방식은 사용에서 제외됐습니다. 스테이징 Auth Site URL은 확정된 Preview 주소로 설정합니다. 이메일 가입을 활성화하고 Magic Link 템플릿에 `{{ .Token }}`으로 6자리 코드를 보내도록 확인합니다. 팀 외 전용 테스트 주소가 필요하면 별도의 SMTP를 검토합니다. OAuth도 검증할 경우 정확한 Preview 호스트의 `/auth/callback`, `/auth/callback/link`만 추가합니다. 일반 이메일 OTP 검증은 앱 내부에서 코드로 완료합니다. [Vercel 환경변수](https://vercel.com/docs/environment-variables) · [Supabase 이메일 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [리디렉션](https://supabase.com/docs/guides/auth/redirect-urls)

## 적용 후 승인된 스테이징 테스트

1. 스테이징 전용 이메일로 일반 A/B와 공식 A/B 계정을 분리하고, 지정 브라우저에서 OTP 수신·입력, 잘못된 코드, 새로고침 후 세션 유지와 로그아웃을 확인합니다. OTP 자체나 키를 로그·보고서에 남기지 않습니다.
2. 일반 A는 합성 투표 생성 시 브라우저 토큰을 받고, 같은 브라우저에서 수정·삭제합니다. 새 브라우저나 일반 B가 토큰 없이 수정·삭제하면 거부되고, 삭제한 테스트 투표 조회는 404여야 합니다.
3. 공식 A는 공개·익명 합성 투표를 생성합니다. 공개 투표의 공식 배지와 익명 투표의 작성자 비표시, 응답 UUID 미노출, 토큰 미발급을 확인합니다. 새 브라우저에서 공식 A가 자기 투표만 수정·삭제할 수 있어야 합니다.
4. 게스트·일반 B·공식 B·만료 세션·교차 출처·폐기된 토큰으로 공식 A 투표에 수정·삭제를 시도해 거부와 상태 불변을 확인합니다. 공식 A의 비활성화와 계정 교체 후에도 이전 투표를 새 공식 B가 관리할 수 없어야 합니다. DB 검증에서 토큰 복원 시도가 거부되어야 합니다.
5. 합성 투표로 게스트 및 로그인 투표의 생성·변경·취소, 댓글·답글, 숨김 정책, Realtime, 공개 이미지 조회와 서비스 경유 업로드·삭제를 확인합니다. 일반 역할의 직접 Storage 쓰기와 비공개 테이블/RPC 접근은 거부되어야 합니다. 테스트는 스테이징 파일·계정·투표만 사용합니다.
6. 기준선 SQL, 스테이징 적용, Vercel/Auth 설정, 스테이징 계정 등록은 다음 승인 단계에서 따로 점검합니다. 운영 적용은 별도 판단입니다.

## 로컬 검증과 이전 비교 증거

- 앞선 검토에서 운영 공개 REST의 데이터 행을 반환하지 않는 HEAD(`limit=0`)로 투표·댓글·공식 통계 공개 필드 HTTP 200, 비공개 작성자 UUID와 소유권 경로 HTTP 401을 확인했습니다. 이는 노출 경계의 관찰이며 운영 내부 객체·권한 전체를 보여주지 않습니다.
- 운영·스테이징에 연결하지 않은 로컬 PGlite 시험 스키마에서 개정된 SQL 01~05와 공식 관리 SQL 회귀 테스트를 다시 실행해 통과했습니다. 00의 별도 로컬 시험에서는 카탈로그 출력 109건에 삽입한 가짜 앱·Storage 행이 포함되지 않음을 확인했습니다. 관리형 Auth·Storage는 로컬 시험 구조이므로 실제 OTP 전송·PostgREST·Storage·Realtime은 미검증입니다.
- 앞선 로컬 이력 리허설에서는 최초 DDL을 임시 시험 정의로 마련해 기존 SQL 29개를 적용했습니다. UTF-8 BOM이 있는 파일은 읽을 때 제거했습니다. SQL 스위트 다섯 개 중 네 개가 통과했습니다. 기존 `content_moderation.sql`은 익명 raw `comment_reactions` 조회를 기대해 권한 거부(42501)로 실패했습니다. 최신 마이그레이션은 해당 조회를 의도적으로 차단합니다. 권한을 완화하는 대신 실제 스테이징 검증에서 해당 조회 거부와 집계 API 성공을 각각 확인합니다.
