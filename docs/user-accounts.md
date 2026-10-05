# 사용자 프로필 / 이메일 OTP 운영 가이드

## 적용 범위

- Google/Kakao OAuth, PKCE callback, cookie refresh, owner token을 유지합니다.
- 새 프로필은 OAuth 이름/이메일이 아닌 서버 생성 닉네임을 사용합니다.
- 질문/댓글/답글의 익명 작성도 로그인이 필요하며 내부 계정 ID는 보존됩니다.
- 투표는 기존 anonymous `voter_id` 방식 그대로입니다. 투표 계정화는 별도 작업입니다.
- 별도 패키지나 환경변수는 추가하지 않았습니다.

## Migration: 수동 적용

파일: `supabase/migrations/20261004155055_add_user_profiles_and_authorship.sql`

이 변경은 코드 작성 중 Production에 적용하지 않았습니다. 기존 Auth 사용자,
질문 본문, 댓글 본문, 투표, 참여자 수, 반응, owner credential을 수정/삭제하지 않습니다.
현재 실계정에 **없는 profiles 행만** 생성합니다. 예전 질문의 author_user_id는 NULL로
두며, 기존 댓글을 임의 계정에 연결하지 않습니다. 새 anonymous flag의 기본값은 false입니다.

Auth INSERT trigger와 Auth 조회/프로필 생성용 내부 helper는 private SECURITY DEFINER입니다.
Auth 전용 DB 역할의 프로필 생성과 Auth 조회 경계에 필요하며, 공개 함수는 service-only INVOKER입니다.
닉네임 변경은 profiles 제약과 `lower(nickname)` unique index로 검증합니다.

### 배포 순서 주의

Migration은 사용자 ID 컬럼의 직접 공개를 막기 위해 polls/comments의 테이블 SELECT를
안전한 컬럼 SELECT로 바꿉니다. **기존 배포의 `SELECT *`는 적용 직후 실패할 수 있습니다.**
반대로 이번 새 API는 is_anonymous/profiles/RPC가 필요하므로 migration 없이 배포하면
계정 관련 기능과 일부 공개 조회가 실패합니다.

따라서 짧은 유지보수 구간을 정해 migration을 한 번의 transaction으로 적용한 뒤
즉시 이 코드 버전을 배포하고 확인하세요. 무중단이 필수라면 별도 선행 배포에서
기존 컬럼만 명시적으로 SELECT하도록 호환 패치를 준비한 후 schema/code를 전환해야 합니다.
이 작업에서는 임의 Production 배포나 선행 커밋을 만들지 않았습니다.

적용 전 SQL Editor에서 `BEGIN;`과 `COMMIT;` 사이에 migration을 실행하는 방법을
사용할 수 있습니다. 실패 시 `ROLLBACK;`하고 먼저 원인을 확인하세요.
local PostgreSQL/Docker가 없는 작업 환경에서 전체 migration/trigger/RLS 실행은
검증되지 않았으므로 적용 전 staging 또는 로컬 Supabase에서 아래 검증을 권장합니다.

## Supabase Dashboard: 이메일 6자리 코드

1. 대상 프로젝트의 **Authentication → Sign In / Providers → Auth Providers → Email**을 엽니다.
   Email provider와 신규 가입 허용을 활성화합니다. Dashboard 버전에 따라 Providers가
   Authentication 하위 메뉴로 직접 표시될 수 있습니다.
2. 같은 Email 설정에서 **Email OTP expiration**을 확인합니다.
   운영 시작값으로 600초(10분)를 권장합니다. **OTP 길이는 6자리**로 설정하세요.
   이 expiry 설정은 다른 이메일 인증 링크에도 적용되므로 기존 메일 기능도 함께 확인합니다.
3. **Authentication → Email Templates → Magic Link**에서 링크 대신 코드를 보여줍니다.
   `{{ .Token }}`을 반드시 사용하고 `{{ .ConfirmationURL }}` 버튼/링크는 제거합니다.
   예시 본문:

   ```html
   <h2>Askio 인증 코드</h2>
   <p>아래 6자리 코드를 로그인 화면에 입력해주세요.</p>
   <p><strong>{{ .Token }}</strong></p>
   <p>요청하지 않았다면 이 메일을 무시해주세요.</p>
   ```

   신규 가입 메일에 **Confirm signup** 템플릿이 사용되는 프로젝트라면 해당 템플릿도
   `{{ .Token }}` 방식으로 맞추고 신규/기존 이메일 각각을 실제로 테스트합니다.
4. **Authentication → Rate Limits**에서 OTP 요청/verification 및 이메일 발송 한도를 확인합니다.
   UI는 중복 요청과 60초 재발송을 제한하지만 보안 경계는 Supabase의 서버 한도입니다.
   UI를 우회한 직접 Auth 요청도 이 한도를 적용받습니다.
5. 기본 이메일 발송 서비스는 제한된 테스트용입니다. 허용 수신자 제한 및 프로젝트
   발송 한도가 있으므로 임의 외부 이메일을 이용한 공개 유입에는 부족할 수 있습니다.
   Custom SMTP는 이번 작업에서 설정하지 않았지만 외부 유입 전 실제 수신 범위를 확인하세요.
6. **Authentication → URL Configuration**의 Site URL은 `https://askio.quest`로 유지하고,
   실제 사용하는 `http://localhost:3000/auth/callback` 및 Production callback을 Redirect URLs에
   허용합니다. OAuth provider callback 설정은 기존대로 둡니다.
   이메일 **코드** 방식은 같은 페이지에서 `verifyOtp({ email, token, type: 'email' })`로
   처리하므로 magic-link redirect를 이용하지 않습니다. 인증 후 원래의 안전한 내부 경로로 이동합니다.
   localhost 포트가 다르면 OAuth callback 허용 URL도 그 포트에 맞춰야 합니다.

가입 여부에 따른 안내, 원문 Auth 오류, 이메일, 인증 코드, 세션 토큰을 로그/analytics에
보내지 않습니다. 인증 실패 안내는 공통 문구입니다.

공식 문서:

- [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [기본 이메일 서비스 / SMTP 제한](https://supabase.com/docs/guides/auth/auth-smtp)

## 수동 적용 후 필수 검증

1. 신규 Google/Kakao/email OTP 각각에서 profiles 자동 생성. 이메일 없는 Kakao도 닉네임 생성.
2. 기존 실계정은 profiles 하나씩만 생성. 새로고침/로그아웃/재로그인 cookie 동작 유지.
3. onboarding 닫기/이대로 시작/이름 변경 후 다시 표시되지 않음. 중복 대소문자/예약어 거절.
4. 비로그인 댓글/생성 401. 로그인 named/anonymous 댓글·답글 및 질문 생성 정상.
5. 익명 댓글 응답에 계정 ID/닉네임/avatar 없음. 직접 REST에서 comments.user_id와
   polls.author_user_id SELECT 실패. Realtime 응답에도 해당 컬럼 없음.
6. profiles는 authenticated 본인만 SELECT/수정 가능. 다른 사용자의 ID를 보내도 접근 불가.
7. 기존 투표/변경투표/owner PATCH·DELETE/admin/moderation/report/reaction 정상.
8. 기존 poll/vote/comment/reaction count 및 participants/votes의 변경이 없는지 비교.

실제 OTP 메일/계정 로그인과 trigger/RLS 검증은 설정 및 migration 적용 후 수행해야 합니다.
mocked regression은 이를 대체하지 않습니다.
