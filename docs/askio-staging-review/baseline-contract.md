# 실제 운영 정의로 기준선을 확정하는 절차

대상은 스테이징 `xfskekmcmwjvuqbthdue`, 비교 원본은 운영 `ckacekbnzfuoiazicxil`, 공식 기능 코드는 `4cb6ae3`입니다. 아래 수집은 읽기 전용입니다. 최종 기준선이 아직 없으므로 현재 파일은 스테이징 적용 승인을 받기 위한 검토 자료입니다.

## 받아야 할 정의

1. [00-exact-definition-export.sql](00-exact-definition-export.sql)과 [01-schema-inventory.sql](01-schema-inventory.sql)의 결과를 운영·스테이징에서 따로 수집합니다. 프로젝트 ref, 추출 시각, PostgreSQL 버전을 함께 기록합니다. 결과는 카탈로그 정의만 공유하고 DB 접속 정보, 키, Auth 사용자, 운영 앱 행, Storage 파일·객체 행은 제외합니다. 함수 기본값·본문에 비밀이 하드코딩돼 있으면 공유 전 보안 검토를 거칩니다.
2. DDL을 별도로 추출할 수 있다면 앱 소유 `public`·`askio_private` 범위에서만 `pg_dump --schema-only`를 사용합니다. 운영 덤프의 데이터 섹션, 전체 `auth`·`storage` 관리 스키마, 플랫폼 역할 생성문과 확장 정의를 기준선으로 복원하지 않습니다. 신뢰 경계가 있는 `SECURITY DEFINER`의 소유자와 권한은 파일에서 제거해 버리기 전에 스테이징 역할 매핑을 별도로 승인합니다.
3. 다음이 누락되면 적용을 보류합니다. `polls`·`comments`를 포함한 전체 앱 테이블 열·타입·기본값·FK·인덱스·시퀀스, 37개 앱 함수의 정확한 시그니처와 본문·소유자·권한, public RLS 12개의 이름과 조건, 앱 트리거 4개의 함수 바인딩과 활성 상태, Realtime 등록의 컬럼·필터·replica identity, 두 버킷에 적용되는 객체 정책과 ACL. 스테이징의 `auth.users`·`auth.uid()`·`auth.jwt()`·`storage.objects`·`storage.buckets`·`supabase_realtime`은 관리형 객체로 존재와 호환성만 확인합니다.
4. 운영 정책 12개와 로컬 비교 11개의 차이는 이름과 명령·역할·`USING`·`WITH CHECK` 단위로 해소합니다. 동작을 모르는 정책을 도입하거나 차이를 수치에 맞춰 제거하지 않습니다. 직접 공개 반응 조회 거부와 앱 집계 API 성공은 별개로 검사합니다.

## 검토할 SQL의 형태

- `00-app-baseline.sql`은 실제 정의를 확보한 뒤 별도로 작성합니다. 스테이징이 여전히 비어 있는지 확인하고, 필요한 기존 관리 객체를 참조합니다. 설치 순서는 앱 스키마와 테이블·시퀀스, 외래키·인덱스, 의존성 순으로 정리한 앱 함수, 트리거, ACL·RLS 그리고 앱 Realtime 등록입니다. Supabase의 기존 publication을 참조하며, 앱의 가입 트리거 하나만 관리형 `auth.users`에 추가합니다. 전체 이력 재실행, seed·backfill 또는 `db push`는 사용하지 않습니다.
- 비교 결과로 확인된 앱 Storage 객체 정책과 빈 버킷 속성을 적용 계획에 분리합니다. 설정값만 재현하고 파일은 복제하지 않습니다. 스테이징용 [02](02-staging-storage-candidate.sql)에서 빈 버킷 구성과 정책을 검토한 후 [03](03-before-official-readonly.sql)으로 기존 계약을 검사합니다.
- [04](04-official-poll-management.sql)는 기능 브랜치 migration 원본입니다. 기반 SQL과 Storage 검증 뒤 별도 승인으로 적용하고, [05](05-after-official-readonly.sql)로 레지스트리 미등록 상태와 공식 계정 관리 경계를 확인합니다.
- 먼저 일회용 로컬 DB에서 검토된 기준선을 합성 데이터로 검증합니다. 이후 승인된 스테이징에서 실제 OTP, 일반 사용자 관리, 게스트 투표, 공개 댓글·프로필, 서비스 경유 이미지 저장, 공식 작성자의 새 기기 관리와 비인가 요청 거부를 확인합니다.

스키마 수집 결과가 확보되면 운영 메타데이터 → 버전 고정 SQL → 스테이징 메타데이터의 대조표를 함께 제출합니다. 현재 검토 파일에는 운영 정의 대신 넣은 임시 DDL이나 운영 데이터가 없습니다.
