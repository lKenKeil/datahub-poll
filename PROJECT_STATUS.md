# PROJECT STATUS

> 분석 기준일: 2026-09-23  
> 분석 범위: 현재 워킹 트리의 Next.js 소스, Supabase 연결 코드와 마이그레이션, 동기화 스크립트, 로컬 환경 변수의 **이름만**, 개발 로그, lint/type/build 및 읽기 전용 실행 확인  
> 이번 분석에서는 기존 기능·디자인·DB 구조를 변경하지 않았고, 쓰기 API 및 DB mutation도 실행하지 않았다.

## 요약

이 프로젝트는 단순 목업을 넘어, 실제 Supabase 데이터를 사용하는 투표 커뮤니티 프로토타입 단계다. 홈 탐색, 투표 생성/참여, 결과 표시, 댓글/답글/반응, Realtime 갱신, 공식 통계 수집/상세 보기, 간이 관리자 화면까지 주요 사용자 흐름이 구현되어 있고 정적 검사와 프로덕션 빌드도 통과한다.

다만 현재 상태를 그대로 인터넷에 공개하기에는 데이터 무결성과 남용 방지 문제가 크다. 익명 사용자가 Supabase anon key로 테이블을 직접 변경할 수 있는 RLS 정책, 클라이언트가 보낸 투표 수·논제 정보를 서버가 신뢰하는 쓰기 API, 투표 중복 방지와 rate limit 부재가 가장 높은 우선순위다. 로그인/소유권/신고·차단 체계도 없다.

`ThemeToggle` hydration mismatch의 직접 원인은 확인됐다. `typeof window !== 'undefined'`는 서버 렌더에서는 `false`, 브라우저의 **첫 hydration 렌더**에서는 이미 `true`가 되어 서버의 `THEME` 버튼과 클라이언트의 `LIGHT/DARK` 버튼이 달라진다. `useState(false)`와 `useEffect(() => setMounted(true), [])`를 쓰는 next-themes 권장 패턴으로 현재 구조를 유지한 채 작게 고칠 수 있다.

## 1. 사용 중인 기술 스택

| 구분 | 현재 상태 |
| --- | --- |
| 프레임워크 | Next.js 16.2.2, App Router, Turbopack |
| UI 런타임 | React / React DOM 19.2.4 |
| 언어 | TypeScript 5.9.3, strict mode, noEmit |
| 스타일 | Tailwind CSS 4.2.2, `@tailwindcss/postcss` 4.2.2 |
| 테마 | next-themes 0.4.6, class 기반 dark mode |
| DB/BaaS | Supabase JS 2.102.1, PostgreSQL/RLS/RPC/Realtime |
| 폰트 | `next/font`의 Geist / Geist Mono |
| lint | ESLint 9.39.4 + eslint-config-next 16.2.2 |
| 실행 확인 환경 | Node 22.20.0, npm 10.9.3 |
| 테스트 | 테스트 프레임워크/테스트 파일/`npm test` 스크립트 없음 |

## 2. 전체 폴더 및 주요 파일 구조

```text
app/
  layout.tsx                       루트 레이아웃, metadata, 테마 Provider/Toggle
  page.tsx                         홈, 검색/필터/HOT/통계/논제 목록, Realtime
  globals.css                      Tailwind 및 light/dark 전역 스타일
  create/page.tsx                  익명 투표 생성 화면
  vote/[id]/page.tsx               투표, 결과, 댓글/답글/반응, Realtime
  stats/[id]/page.tsx              공식 통계 상세, 시계열/랭킹/출처
  admin/page.tsx                   헤더 키 기반 투표 조회/수정/삭제 UI
  api/
    polls/                         목록/생성/상세/투표/댓글 Route Handlers
    comments/[id]/react/           댓글 좋아요/싫어요
    official-statistics/           공식 통계 목록/단건 API
    admin/polls/                   관리자 조회/수정/삭제 API
    health/supabase/               Supabase 연결 상태 API
components/
  theme-provider.tsx               next-themes 래퍼
  theme-toggle.tsx                 테마 토글; 현재 hydration mismatch 발생 지점
lib/
  types.ts                         Poll/통계/댓글 공용 타입
  supabase.ts                      브라우저 anon 클라이언트/Realtime
  supabase-server.ts               서버 클라이언트; service role 없으면 anon key 사용
  admin-auth.ts                    x-admin-key 비교
data/polls.ts                      코드에 고정된 오피셜 투표 2개
supabase/migrations/               RLS, Realtime, vote RPC, 공식 통계 스키마/seed
scripts/sync-official-stats.mjs    World Bank 및 큐레이션 통계 동기화
docs/official-stats-playbook.md    공식 통계 운영 원칙
public/                            create-next-app 기본 SVG와 favicon
```

`loading.tsx`, `error.tsx`, `not-found.tsx`, `robots.ts`, `sitemap.ts`, Open Graph 이미지, `proxy.ts`는 없다.

## 3. 현재 구현된 기능

- 홈 대시보드
  - 카테고리 필터와 텍스트 검색
  - 코드에 고정된 오피셜 논제와 DB 커뮤니티 논제 분리 표시
  - 공식 통계 카드와 상세 링크
  - 참여자 수, 접전 여부, 최근 생성 여부를 조합한 HOT/트렌딩 표시
  - Supabase Realtime 구독과 20~30초 polling 보완
- 투표 생성
  - 제목, 카테고리, 2~6개 선택지, 선택형 `official_fact`
  - 클라이언트 미리보기와 기본 validation
- 투표 참여/결과
  - optimistic UI
  - PostgreSQL RPC를 통한 원자적 증가 경로
  - RPC 실패 시 upsert fallback
  - 투표 후 퍼센트 막대 표시
- 커뮤니티
  - 익명 댓글, 1단계 답글
  - 좋아요/싫어요 토글
  - 브라우저 localStorage fingerprint 기반 내 반응 표시
- 공식 통계
  - `official_sources`, `official_statistics` 테이블 정의
  - 검증된 통계 목록 API
  - 최신값, 전년 대비, 최근 시계열, 글로벌 Top 10, 연관 통계, 출처 표시
  - World Bank API 동기화 스크립트와 KOSIS/OECD/Cloudflare 레퍼런스
- 관리자
  - `x-admin-key`가 맞을 때 투표 조회/검색/수정/삭제
  - 투표 삭제 전에 반응과 댓글을 순서대로 삭제
- 운영 확인
  - Supabase health endpoint
  - server-only Supabase 모듈
  - `.env.local`은 Git에 추적되지 않음

## 4. 구현은 되어 있지만 미완성인 기능

- HOT/랭킹: 홈에서만 계산하는 휴리스틱이다. 기간별 집계, 조회수, 참여 속도, 조작 방지, 동점 규칙이 없다.
- 검색: 현재 브라우저에 받아온 투표 및 최대 8개 공식 통계만 대상으로 하는 인메모리 검색이다. URL 상태, 서버 검색, pagination, 전문 검색이 없다.
- 공식 통계: 수집 파이프라인은 있으나 스케줄러, retry/timeout, 실패 알림, 원자적 배치, 데이터 품질 검증 자동화가 없다.
- 통계 단위 표시: 동기화 스크립트는 많은 지표 단위를 알지만 홈/상세 formatter는 일부만 지원해 GDP, 기대수명, PM2.5, 출산율 등에서 단위가 빠지거나 부정확할 수 있다.
- 관리자: 투표만 관리한다. 댓글 moderation, 통계 검수, 사용자/신고 관리, 감사 로그가 없다. 현재 로컬 설정에는 관리자 키가 없어 API가 401을 반환한다.
- 반응 식별: fingerprint는 로그인 식별자가 아니라 사용자가 바꿀 수 있는 localStorage 문자열이다.
- 오피셜 투표: `data/polls.ts`의 정적 데이터와 `official_<id>` DB row가 혼합되어 source of truth가 둘이다.
- 에러 UX: 대부분 `alert`, console, 빈 목록으로 처리하며 route-level error/loading/not-found UI가 없다.
- 반응형: Tailwind breakpoint 사용은 되어 있으나 실제 기기/브라우저 회귀 테스트가 없다.

## 5. 아직 없는 주요 기능

- Supabase Auth 또는 별도 로그인/회원/세션
- 작성자 소유권, 내 투표/내 댓글, 프로필
- 한 사용자 한 표 정책 또는 익명 투표의 서버 측 중복 방지
- 신고, 숨김, 차단, 금칙어/스팸 대응, 관리자 moderation queue
- 댓글/투표 수정·삭제 권한 모델
- 투표 마감 시간, 공개/비공개, 상태(초안/게시/종료), 결과 공개 정책
- 갈드컵 토너먼트 라운드/대진표. 현재는 다중 선택지 1회 투표 구조다.
- 공유 버튼, Web Share API, 링크 복사, SNS용 동적 OG 이미지
- 조회수/북마크/알림
- pagination/infinite scroll
- 분석/모니터링/에러 추적/감사 로그
- 자동 테스트, CI/CD 품질 게이트
- 이용약관, 개인정보처리방침, 커뮤니티 운영정책

## 6. Supabase 연결 구조

```text
브라우저 Client Components
  ├─ same-origin /api/* 호출
  └─ lib/supabase.ts의 anon client로 Realtime 구독

Next.js Route Handler / Server Component
  └─ lib/supabase-server.ts
       ├─ SUPABASE_SERVICE_ROLE_KEY가 있으면 해당 키
       └─ 없으면 NEXT_PUBLIC_SUPABASE_ANON_KEY로 fallback
```

현재 `.env.local`에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 이름만 선언되어 있고 실제 값은 확인/기록하지 않았다. `SUPABASE_SERVICE_ROLE_KEY`와 `ADMIN_DASHBOARD_KEY`는 현재 로컬 파일 및 프로세스에 설정되어 있지 않다. 따라서 지금 서버 연결은 anon key fallback으로 동작한다.

읽기 전용 실행 확인 결과:

- `/api/health/supabase`: 200, `ok:true`
- `/api/polls`: 200, 8건
- `/api/official-statistics`: 200, 8건
- 홈, 생성, 관리자, 실제 투표 상세, 실제 통계 상세: 모두 200
- `/api/admin/polls` 무키 요청: 401

과거 `.next-dev.*.log`에는 네트워크 장애 시점의 polls/statistics 500과 `fetch failed`가 남아 있지만, 현재 프로덕션 빌드 실행에서는 재현되지 않았다.

## 7. DB 관련 코드 구조

확인되는 논리 테이블은 다음과 같다.

- `polls`: id, title, category, options[], votes[], participants, official_fact, created_at
- `comments`: id, poll_id, text, user_name, created_at, parent_id
- `comment_reactions`: comment_id, user_fingerprint, reaction, timestamps
- `official_sources`: 공식 출처 메타데이터
- `official_statistics`: 통계 본문, 날짜, 출처, tags, metadata JSONB, 검증 상태

핵심 RPC `increment_poll_vote`는 row lock(`FOR UPDATE`)으로 정상 경로의 동시 증가를 원자적으로 처리한다. 반면 다음 구조적 빈틈이 있다.

- 저장소의 마이그레이션에는 `polls`와 `comments`의 최초 `CREATE TABLE`이 없다. 새 Supabase 프로젝트를 migrations만으로 재구축할 수 없다.
- comments → polls, reactions → comments, replies → parent comment의 외래키가 현재 migration에서 보이지 않는다. orphan 데이터가 가능하다.
- options/votes 배열 길이, participants와 votes 합, 문자열 길이를 보장하는 DB constraint가 없다.
- 관리자 삭제는 여러 쿼리로 나뉘며 transaction이 아니어서 중간 실패 시 부분 삭제가 가능하다.
- Realtime publication migration은 재실행 안전성이 부족하다.
- `SECURITY DEFINER` RPC에 고정 `search_path`가 명시되지 않았고 anon/authenticated 실행 권한이 열려 있다.

## 8. 로그인/회원 시스템 구현 여부

구현되어 있지 않다. Supabase Auth 패키지는 supabase-js의 하위 의존성으로 설치되어 있을 뿐 앱에서 세션, 로그인, 회원가입, 사용자 테이블을 사용하지 않는다.

- 모든 작성자는 사실상 익명이다.
- 댓글 DB에는 `user_name = "익명 유저"`를 저장하지만 화면은 항상 `GUEST_USER`로 표시한다.
- 투표 여부는 React state에만 있어 새로고침/다른 브라우저/스크립트 호출로 반복 투표할 수 있다.
- 반응만 localStorage fingerprint를 쓰지만 쉽게 위조/초기화할 수 있다.

## 9. 투표 생성 구조

`/create` → `POST /api/polls` → `polls.insert` 흐름이다.

클라이언트는 `custom_<timestamp>_<random>` id와 0으로 초기화한 votes/participants를 보낸다. 서버도 제목/카테고리/선택지 수/중복 여부를 검사하지만 다음이 미완성이다.

- 인증, 작성자, CAPTCHA, rate limit이 없다.
- 서버가 클라이언트가 보낸 `id`, 초기 `votes`, `participants`를 허용한다.
- UI는 제목 120자/선택지 50자/팩트 300자를 제한하지만 동일한 최대 길이 검증이 서버에는 없다.
- 아무 사용자나 `official_fact`를 작성할 수 있어 “공식 팩트” 신뢰 표기가 오용될 수 있다.
- id는 DB default/UUID가 아니라 클라이언트가 생성한다.

## 10. 투표 참여 및 결과 저장 구조

`/vote/[id]`가 optimistic update 후 `POST /api/polls/[id]/vote`를 호출한다.

- 정상 경로: `increment_poll_vote` RPC가 row lock 후 해당 배열 인덱스를 증가한다.
- 오피셜 정적 논제는 최초 참여 시 `official_<id>` row로 seed된다.
- 실패 경로: 클라이언트 snapshot에 1을 더해 `polls.upsert`한다.

치명적인 문제는 API가 `optionIndex`, title, category, options, votes, participants를 모두 클라이언트에서 받아 신뢰한다는 점이다. RPC가 어떤 이유로 실패해도 fallback upsert가 실행되어 기존 데이터를 오래된 snapshot으로 덮거나 조작된 수치로 만들 수 있다. 댓글 등록 API도 댓글을 넣기 전에 클라이언트가 보낸 전체 poll snapshot을 upsert하므로, 오래 열린 화면에서 댓글만 작성해도 최신 투표 결과를 과거 값으로 되돌릴 수 있다.

## 11. 통계 기능 구현 상태

기능 범위는 프로토타입 중 가장 충실한 편이다.

- verified 목록 조회, 최신값/연도, 시계열, 전년 대비, 글로벌 랭킹, 연관 통계, 출처 링크 구현
- World Bank 자동 수집과 KOSIS/OECD/Cloudflare 큐레이션 구조 구현
- 홈은 최신 8건만 받아 검색/표시
- 상세 페이지는 Server Component에서 Supabase 직접 조회

보완점:

- 동기화 자동 일정과 운영 실패 복구가 없다.
- 상세 페이지/API는 `is_verified=true` 조건을 강제하지 않는다.
- formatter가 세 파일 이상에 중복되고 지원 단위가 서로 다르다.
- 통계와 관련 투표를 연결할 FK/metadata 필드는 playbook의 “next step”으로 남아 있다.
- 차트는 최소값을 0 높이로 정규화해 작은 변화가 과장될 수 있고 축/단위 설명이 약하다.

## 12. 관리자 기능 구현 상태

`/admin`에서 키를 입력해 투표 목록을 받고 수정/삭제할 수 있다. 서버는 `ADMIN_DASHBOARD_KEY`와 `x-admin-key`를 비교한다.

현재는 키가 설정되지 않아 실사용 불가이며, 출시용 인증으로는 부족하다.

- 키를 localStorage에 평문 보관
- 관리자 세션 만료/로그아웃/권한 등급/2FA 없음
- brute-force 방지와 rate limit 없음
- 변경 감사 로그와 복구 기능 없음
- 댓글/통계/신고 moderation 없음
- 서비스 role을 설정하면 Route Handler의 작은 검증 실수가 전체 DB 고권한 작업으로 이어질 수 있음

## 13. 검색/SEO 구현 상태

검색은 제목/카테고리/공식 팩트/통계 요약/태그의 클라이언트 substring 검색으로 동작한다. 소규모 MVP 탐색에는 쓸 수 있지만 데이터 증가 시 확장되지 않는다.

SEO는 루트의 고정 title/description과 favicon만 있다.

- 투표/통계별 `generateMetadata` 없음
- canonical, robots, sitemap, OG/Twitter 이미지, JSON-LD 없음
- 홈이 대형 Client Component이며 DB 콘텐츠는 hydration 이후 fetch하므로 검색 엔진 초기 문서와 성능에 불리함
- 검색/카테고리 상태가 URL에 남지 않음

## 14. 모바일/반응형 구현 상태

`md`, `lg` grid와 responsive typography를 사용해 기본적인 축소 배치는 구현되어 있다. 다만 자동/수동 viewport 테스트가 없고 다음 충돌 가능성이 보인다.

- ThemeToggle이 `fixed right-4 top-4 z-[100]`이고 홈 우측 생성 버튼과 같은 영역을 사용해 작은 화면에서 겹칠 수 있다.
- 관리자 키 입력 행은 항상 `flex`이며 작은 폭에서 input/button이 압축 또는 overflow될 수 있다.
- 댓글 반응 버튼 행, 답글 input/button은 wrap 처리가 없다.
- 통계 랭킹/표, 10개 시계열 막대의 좁은 화면 가독성 검증이 필요하다.
- 접근성 label 연결, 토글의 aria 상태, 키보드 focus, 색 대비 검사가 필요하다.

## 15. 공유 기능 구현 여부

구현되어 있지 않다. 상세 URL 자체는 직접 공유할 수 있지만 공유 버튼, 링크 복사, Web Share API, SNS별 카드/동적 OG 이미지가 없다.

## 16. 인기/랭킹 기능 구현 여부

부분 구현이다.

- 참여자 수 + 36시간 freshness 가중치 + 접전 가중치로 trending score 계산
- 참여자 20명 이상, 접전, 또는 최근 72시간/5명 이상이면 HOT
- 홈 상위 4개와 대표 battle 노출

서버에 고정된 집계가 아니므로 시간창별 랭킹, 조회수, 급상승 속도, 부정 투표 제외, 캐시가 없고 여러 클라이언트에서 결과의 기준 시점도 다를 수 있다.

## 17. 잠재적인 버그

### ThemeToggle hydration mismatch

현재 코드:

```tsx
const mounted = typeof window !== 'undefined'
```

서버에서는 placeholder(`THEME`, placeholder class), 첫 브라우저 렌더에서는 실제 버튼(`LIGHT` 또는 `DARK`, 다른 class)을 만들기 때문에 React hydration 규칙을 위반한다. `<html suppressHydrationWarning>`은 html 한 단계의 class 차이를 위한 것이며 하위 버튼 mismatch를 숨기지 않는다.

현재 구조를 유지하는 안전한 수정 방향:

```tsx
const [mounted, setMounted] = useState(false)
const { resolvedTheme, setTheme } = useTheme()

useEffect(() => setMounted(true), [])

if (!mounted) {
  return <button type="button" disabled aria-label="테마 불러오는 중">THEME</button>
}
```

placeholder의 크기/class를 실제 버튼과 맞추면 layout shift도 줄일 수 있다. `enableSystem={false}`인 현재는 `theme`도 가능하지만, 이후 system theme를 열 가능성을 고려하면 `resolvedTheme`가 더 안전하다. 이 수정은 아직 적용하지 않았다.

### script tag React 경고

이 경고는 ThemeToggle의 텍스트 mismatch와 별개로 `next-themes@0.4.6`이 anti-FOUC용 inline `<script>`를 Provider 안에서 렌더하는 방식과 Next 16.2/React 19 조합에서 보고된 upstream 문제다. next-themes 이슈 [#385](https://github.com/pacocoursey/next-themes/issues/385)와 [#387](https://github.com/pacocoursey/next-themes/issues/387)이 현재 열려 있다.

우선 mounted 수정으로 실제 hydration 실패를 제거한 뒤 재검증해야 한다. script 경고만 남는다면 콘솔 monkey patch로 숨기지 말고, upstream 패치 버전 확인 → 작은 재현 테스트 → 필요 시 서버 초기화 script 또는 검증된 대체 구현 순서로 다루는 것이 안전하다.

### 그 밖의 버그 후보

- 댓글 POST가 poll 전체를 upsert해 동시 투표 결과를 과거 snapshot으로 되돌릴 수 있음
- RPC 오류 종류를 구분하지 않고 fallback upsert해 invalid input도 우회 가능
- fallback vote는 동시 요청에서 lost update 가능
- 서버 validation 전에 optionIndex 범위/정수 여부를 검사하지 않음
- 홈 fetch에 네트워크 rejection용 `catch`가 없어 unhandled rejection 가능
- 관리자에서 선택지 순서를 바꾸면 기존 votes가 “내용”이 아니라 인덱스를 따라가 잘못 대응될 수 있음
- 관리자 다단계 삭제가 부분 실패할 수 있음
- 공식 통계 단위 formatter가 sync 스크립트와 UI에서 불일치
- 상세 통계의 미검증 row 접근 가능
- API가 Supabase 오류 메시지를 그대로 반환해 내부 정보가 노출될 수 있음
- health API가 key type/length와 프로젝트 host를 공개함

## 18. 보안상 확인해야 할 부분

### 출시 차단 수준

1. `polls` RLS가 anon insert/update를 허용한다. 공개 anon key는 원래 브라우저에 노출되는 값이므로 공격자가 Next API를 거치지 않고 poll을 생성·변조할 수 있다.
2. `comment_reactions`도 anon insert/update/delete가 모두 허용되어 fingerprint 제한을 직접 우회할 수 있다.
3. 투표/댓글 Route Handler가 클라이언트 poll snapshot을 신뢰해 결과와 논제 내용을 조작할 수 있다.
4. 투표, 논제 생성, 댓글, 반응 어디에도 rate limit/CAPTCHA/abuse control이 없다.
5. 한 사람 한 표 또는 합의된 익명 중복 방지 정책이 없다.

### 추가 확인

- service role 사용 시 오직 검증된 서버 경로에서만 접근하고 fallback 정책을 명확히 분리할 것
- 입력 schema validation(Zod 등), body 크기/문자열 최대 길이, id 형식, parent/poll 존재 여부 확인
- RLS를 read 중심으로 축소하고 mutation은 검증된 RPC/서버 경로만 허용
- RPC에 최소 권한, 고정 `search_path`, 입력 검증 추가
- 관리자 키 방식 대신 세션 기반 관리자 계정/RBAC와 HttpOnly 쿠키 고려
- production health 응답 최소화 또는 내부 모니터링 전용화
- 보안 헤더(CSP, frame-ancestors, referrer policy 등)와 배포 플랫폼 설정
- logging 시 사용자 입력/키/개인정보 마스킹
- 개인정보·fingerprint 사용 고지 및 보존 정책

React는 현재 댓글 텍스트를 일반 문자열로 렌더하므로 직접적인 HTML injection 지점은 발견되지 않았다. 하지만 이것이 인증/권한/남용 문제를 완화하지는 않는다.

## 19. 사용하지 않는 코드나 중복 코드

- `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`는 현재 참조가 없는 create-next-app 기본 자산이다.
- `/api/official-statistics/[id]`는 현재 앱 내부에서 호출되지 않고 통계 상세 페이지는 Supabase를 직접 조회한다.
- `getReliability`가 홈과 투표 상세에 중복되어 있다.
- 통계 값 formatting 로직이 홈, 통계 상세, sync 스크립트에 중복되고 이미 동작 차이가 생겼다.
- `DbPollWithOfficialFact`는 `DbPoll`에 이미 있는 `official_fact` 일부를 다시 선언한다.
- `user_name`을 저장하지만 UI에서는 사용하지 않는다.
- `official_fact` 컬럼 미적용 DB용 retry는 migration 완료 이후 제거 후보지만, 실제 운영 DB migration 상태 확인 전에는 유지해야 한다.
- README는 create-next-app 기본 내용 위주이고 끝부분에 NUL 문자가 섞인 흔적이 있어 프로젝트 문서로 갱신이 필요하다.
- `.next-dev.err.log`, `.next-dev.out.log`가 untracked로 남아 있으며 `.gitignore` 대상도 아니다. 필요한 진단을 보존한 뒤 정책을 정해야 한다.
- `CLAUDE.md`는 실질 내용이 거의 없다.

사용하지 않는 것으로 보이는 항목도 이번 분석에서는 삭제하지 않았다.

## 20. npm dependencies / lint / type / production build

2026-09-23 실행 결과:

| 검사 | 결과 |
| --- | --- |
| `npm run lint` | 통과, 오류/경고 없음 |
| `npx tsc --noEmit` | 통과 |
| `npm run build` | 통과, 4.5초 compile / 모든 route 생성 성공 |
| production smoke test | 홈/생성/관리자/투표 상세/통계 상세 및 주요 읽기 API 정상 |
| `npm ls --depth=0` | 앱 의존성 로드 성공, extraneous 패키지 5개 표시 |
| `npm outdated` | Next 16.3.5, Supabase 2.117.0 등 업데이트 가능 |
| `npm audit --omit=dev` | 6건: critical 1, high 4, moderate 1 |

감사 항목에는 Next.js 16.2.2, Next가 포함한 postcss/sharp, nanoid, Supabase realtime 계열의 ws, baseline-browser-mapping이 포함된다. 특히 npm audit은 현재 Next 범위를 critical로 분류하며 16.3.5에서 해소 가능한 것으로 안내한다. 자동 `npm audit fix --force`는 실행하지 않았다. Next/React는 프로젝트 규칙상 버전별 breaking change를 먼저 확인하고, 16.3.x 로컬 문서/릴리스 노트 검토 → 별도 브랜치 업데이트 → 전체 회귀 테스트가 필요하다.

extraneous 항목은 `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`이다. 소스에서 직접 사용하지 않으며, lockfile과 node_modules가 어긋난 로컬 설치 잔여물인지 `npm ci`가 가능한 깨끗한 환경에서 확인해야 한다.

## [현재 프로젝트 완성도]

- 기능 구현 완성도: 약 60%. 핵심 사용자 흐름이 실제 DB와 연결된 기능성 프로토타입이다.
- 공개 서비스 준비도: 약 35%. 보안, 무결성, 인증/중복 투표, moderation, 테스트/운영 체계가 출시를 막는다.
- ThemeToggle 문제는 작은 국소 수정으로 해결 가능하며 대규모 리팩터링 사유가 아니다.

## [정상 작동 기능]

- Supabase 연결과 health check
- 투표/공식 통계 목록 조회
- 홈 검색/카테고리/HOT UI
- 투표 생성 화면과 DB insert 경로
- 투표 RPC 정상 경로와 결과 UI
- 댓글/답글/반응 및 Realtime/polling 갱신
- 공식 통계 목록/상세/시계열/랭킹/출처
- 관리자 페이지 노출 및 무키 요청 차단
- lint, type check, production build

## [미완성 기능]

- 로그인/회원/작성자 소유권
- 익명 사용자 식별과 중복 투표 방지
- 관리자 인증과 moderation
- 통계 자동 운영/품질 검증/투표 연결
- 서버 검색/pagination/정식 랭킹
- SEO/공유/동적 metadata
- 모바일·접근성 실기기 검증
- 테스트/CI/관측성/복구 체계

## [발견된 문제]

- ThemeToggle hydration mismatch
- next-themes inline script 관련 React 개발 경고
- 댓글 작성 시 poll snapshot 덮어쓰기 가능
- RPC 실패 fallback의 lost update/검증 우회 위험
- UI와 sync 간 통계 단위 formatter 불일치
- base table 생성 migration 부재
- 관리자 키 미설정 및 localStorage 기반 키 보관
- stale README, 중복 유틸, 미사용 기본 자산/로그
- npm production dependency 취약점 6건

## [치명도 높은 문제]

1. anon RLS로 polls/reactions 직접 변조 가능
2. 쓰기 API가 클라이언트의 votes/participants/title/options를 신뢰
3. 무제한 반복 투표/생성/댓글/반응과 rate limit 부재
4. 댓글 POST가 최신 투표 결과를 되돌릴 수 있는 데이터 무결성 문제
5. 취약점 권고 대상 Next.js 16.2.2 사용
6. 재현 가능한 전체 DB schema migration 부재

## [MVP 출시 전 필수 작업]

1. 쓰기 정책/RLS/RPC/API를 최소 권한으로 재설계하고 클라이언트 poll snapshot을 신뢰하지 않도록 수정
2. 투표 정수 index, 리소스 존재, 문자열 길이, category/options를 서버 schema로 검증
3. 중복 투표 정책을 정하고 서버 측 식별/제약 구현
4. rate limit, CAPTCHA 또는 동등한 abuse control 적용
5. ThemeToggle을 effect 기반 mounted 패턴으로 수정하고 script 경고를 별도 재검증
6. Next.js 보안 패치 버전 업그레이드와 전체 회귀 테스트
7. polls/comments 포함 전체 재현 migration, FK/check constraint, transaction/cascade 정리
8. 관리자 세션/RBAC 및 댓글·신고 moderation 최소 기능
9. 핵심 API integration test, vote 동시성 test, E2E smoke test와 CI 구성
10. production env 분리, 오류 모니터링, 백업/복구, 로그, 개인정보/운영정책 준비

## [나중에 해도 되는 작업]

- 고급 추천/개인화
- 정교한 기간별 인기 랭킹과 분석 대시보드
- 토너먼트형 갈드컵 대진 기능
- 북마크/알림/팔로우
- 풍부한 애니메이션 및 디자인 시스템 리팩터링
- 공식 통계 출처 확대와 고급 시각화
- 미사용 기본 SVG/중복 유틸 정리

## [추천 개발 순서]

1. **현재 기준선 고정**: 사용자 작업 중 diff를 보존하고 이 문서 기준으로 이슈 목록 생성
2. **작은 UI 안정화**: ThemeToggle mounted 수정 → hydration 재검증 → 남는 script 경고 분리
3. **데이터 무결성 차단**: vote/comments/create API validation, fallback 제거 또는 안전화, 서버 조회 기반 mutation
4. **DB 권한/스키마**: RLS 최소화, RPC 권한 강화, 전체 migration/FK/constraint/transaction 완성
5. **남용 방지/사용자 정책**: 중복 투표 정책, rate limit, CAPTCHA, 익명 또는 Auth 전략 확정
6. **관리/운영**: 관리자 세션, 신고/숨김/삭제, 감사 로그, 통계 검수
7. **보안 업데이트와 자동 검증**: Next 16.3.x 검토, dependency 정리, integration/E2E/concurrency test, CI
8. **출시 UX**: error/loading/not-found, 모바일/접근성, SEO, sitemap/robots, 공유/OG
9. **배포 준비**: production env, 모니터링, 백업/복구 리허설, 정책 문서, 제한된 beta 출시
