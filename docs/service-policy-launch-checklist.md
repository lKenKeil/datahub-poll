# Askio 서비스 정책 공개 전 확인 목록

기준: 2026-10-07 저장소 구현. Production DB, Auth Dashboard, 계약 또는 제공자 설정을 변경하거나 검증한 결과가 아니다.

`/privacy`와 `/terms`는 **공개 전 검토 초안**이다. 운영자명과 문의 이메일은 사용자가 아직 확정하지 않았다고 답했다. 미확정 정보가 있는 상태로 OAuth 심사나 외부 유입용 최종 정책이라고 제출하지 않는다. 법률 검토나 준수 보증을 대신하지 않는다.

## 현재 구현과 문서의 연결

| 처리 | 확인한 코드 | 문서에 반영한 내용 |
| --- | --- | --- |
| 인증·세션 | `components/auth-provider.tsx`, `lib/supabase-auth-browser.ts`, `lib/supabase-auth-server.ts`, `lib/email-auth.ts` | Google·카카오·이메일 OTP, 자동 계정 생성, 세션 쿠키. 앱의 이메일 로그인은 비밀번호 방식이 아님 |
| 프로필 | `lib/profile.ts`, `app/api/profile/route.ts`, 관련 profiles migration | 자동 닉네임, 수정, 최초 설정. profiles에 이메일 복제 없음. 소셜 이름을 공개 닉네임으로 강제하지 않음 |
| 프로필 사진 | `app/api/profile/avatar/route.ts`, `lib/public-identity.ts`, 관련 avatar migration | 공개 기본 꺼짐, 익명 응답에 계정 정보 비노출. 공개 Storage URL 접근은 설정 변경만으로 철회되지 않음 |
| 질문·의견 | `app/api/polls/route.ts`, `app/api/comments/route.ts`, `lib/public-identity.ts` | 회원 질문 작성, 회원·비회원 의견. 회원 익명 작성의 내부 user_id는 보존. 과거 user_id null 호환 |
| 참여 식별 | `lib/comment-identity.ts`, `lib/poll-vote-identity.ts`, `lib/voter-id.ts`, `lib/poll-vote-identity-request.ts` | guest 쿠키 및 변환값, 로그인 후 기존 브라우저 참여 연결, 중복 제한의 기술적 한계. 공개 문서에 비밀·알고리즘·DB 필드 설명 없음 |
| 신고·운영 | `lib/content-report-server.ts`, `lib/admin-moderation.ts`, 관련 report/admin routes 및 migration | 비공개 신고·처리 기록, 운영자 수동 숨김·복구·삭제, 자동 누적 숨김·계정 차단 없음 |
| 브라우저 저장 | `app/vote/[id]/page.tsx`, `lib/poll-owner-storage.ts`, `lib/poll-discovery-session.ts`, `lib/report-reporter-id.ts`, 관련 theme helpers | 소유자 토큰, 이전 참여 식별자, 신고 식별자, 테마, 최근 질문. 브라우저 정리는 DB 삭제가 아님 |
| 요청 제한 | `lib/rate-limit.ts` | IP를 일시 읽어 변환, 메모리 카운터. 앱 limiter에서 원본 IP DB 저장 없음. 외부 로그까지 미수집이라고 주장하지 않음 |
| 분석 | `instrumentation-client.ts`, `lib/analytics.ts`, 설치된 `posthog-js` | Production+env+nonlocalhost만. 페이지 조회와 6개 custom event. autocapture·replay·identify·person profiles 없음 |
| 공식 자료 | `lib/official-statistics.ts`, 관련 공식 통계 routes/UI | 원 출처 통계와 편의상 요약·시각화. 커뮤니티 투표는 대표 표본 조사 아님 |

파일명은 감사 시 관련 경로를 묶어 설명한 것이며, 개인정보·비밀 값을 이 문서에 복제하지 않는다.

## 공개 전 필수 입력 / 결정

- `lib/service-policies.ts`: 운영자명, 유효한 개인정보·서비스 문의 이메일, 시행일. 개인정보 보호 담당자와 권리 요청 처리 절차도 실제 운영 방식에 맞게 안내한다.
- 사업 형태에 따라 필요한 사업자·대표자·주소 등 공개 정보의 범위를 확인한다. 미확정 사업자등록번호·주소 등을 만들지 않는다.
- 계정·프로필·콘텐츠·투표·신고·처리 기록별 보유기간, 파기 기준·방법, 법적 보존 근거와 기간을 결정한다. 현재 앱에 자동 TTL이나 계정 탈퇴 화면이 없다는 것과 적법한 보유기간이 정해졌다는 것은 다르다.
- 계정 삭제 요청 시 게시물·댓글·투표·신고 기록·업로드 파일·백업을 어떻게 처리할지 정한다. 회원을 내부적으로 연결한 익명 작성도 포함한다.
- 실제 Supabase 프로젝트 지역, Vercel 처리 구조, PostHog cloud/self-hosted 및 지역·보유 설정, 연결된 SMTP 발송 업체를 Dashboard와 계약에서 확인한다. 비밀 값은 문서에 기록하지 않는다.
- 각 제공자의 법적 역할(위탁/제3자 제공 등), 국외 이전 여부와 수신자·국가·항목·시기·방법·목적·기간, 필요한 고지·동의·거부 안내를 검토한다. OAuth 제공자를 단순히 모두 같은 수탁자로 묶지 않는다.
- PostHog 분석에 필요한 동의·거부 수단과 안내를 확인한다. 현재 in-app opt-out은 없고, 브라우저 쿠키 삭제는 향후 이벤트 차단이 아니다.
- 자동 pageview는 URL·referrer·UTM·페이지 제목을 포함할 수 있다. 질문 제목이나 검색어가 URL/제목에 들어갈 수 있다. custom event에서 원문을 안 보내는 것만으로 자동 metadata가 무해하다고 단정하지 않는다. 필요하면 **별도 승인된 후속 작업**으로 정리한다.
- 로그인 제공자별 실제 scope·동의 항목, SMTP 발송 처리, 외부 소셜 이미지 요청을 확인한다. 제공자 비밀번호를 Askio가 직접 받는 구조는 아니다.
- 만 14세 미만 이용 등 대상 연령과 동의 절차가 필요한지 결정한다. 현재 연령 확인·법정대리인 동의 구현이 없는 상태에서 있다고 문서에 쓰지 않는다.
- 약관 안내·동의와 정책 변경 고지 방식이 적절한지 검토한다. 이 작업의 링크 추가는 동의를 받는 기능이 아니다.
- 공개 이미지 URL은 숨김/사진 비공개로 접근이 철회되지 않는다. 최종 삭제는 기존 cleanup을 사용하되 캐시·백업·실패 재처리 범위도 확인한다.

## 분석 범위 확인

- 초기화는 `instrumentation-client.ts`가 `initializeAnalytics()`를 호출한다.
- custom event: `poll_card_clicked`, `poll_viewed`, `vote_submitted`, `vote_result_viewed`, `next_poll_clicked`, `poll_created`.
- 직접 이벤트 속성은 poll ID, category, section/position, participants/viewer state, option index/action, result source, from/to ID, option/image count로 제한한다.
- account ID, voter ID, fingerprint, owner token, 이메일, 질문/선택지/댓글 원문, 이미지 URL을 custom property로 보내지 않는다.
- 설치된 SDK 기본 persistence는 `localStorage+cookie`, 기본 cookie 만료는 365일이다. 앱이 별도 persistence/만료를 지정하지 않는다. 실제 로그·이벤트 보유는 PostHog 프로젝트 설정 확인이 필요하다.
- 현재 SDK 기본 `ip: false`와 별개로 서비스 제공자에게 네트워크 접속 정보는 전달될 수 있다. 이를 “모든 제공자가 IP를 전혀 받지 않는다”는 의미로 설명하지 않는다.

## 공식 확인 자료

- [개인정보 보호법 제30조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1032645945): 처리 목적·보유기간·권리·문의·자동 수집 장치 등 정책에 필요한 안내 범위 확인.
- [개인정보 포털 자료실](https://www.privacy.go.kr/front/bbs/bbsList.do?bbsNo=BBSMSTR_000000000049): 2026 개인정보 처리방침 작성지침 확인 경로. 최종 검토에서 해당 지침과 실제 처리 구조를 대조한다.
- [Supabase Storage bucket 안내](https://supabase.com/docs/guides/storage/buckets/fundamentals): public bucket의 알려진 URL 접근 특성.
- [Supabase SMTP 안내](https://supabase.com/docs/guides/auth/auth-smtp): 운영 메일 발송 설정과 제한 확인.

## 배포·등록 순서 (이 작업에서는 실행하지 않음)

1. 운영자·연락처·보유기간·이전 정보 확정 및 법률 검토 후 초안 표시와 문서 내용을 함께 갱신.
2. 검토 완료 후 별도 승인으로 push/deploy.
3. Google OAuth Branding: Privacy `https://askio.quest/privacy`, Terms `https://askio.quest/terms` 등록. callback URL과 혼동하지 않는다.
4. 카카오 서비스 정보의 개인정보처리방침·이용약관 URL에 동일 주소 등록.
5. 잔여 `polls_full_access` / `comments_full_access` 정책은 별도 read-only RLS audit.
6. Production 공개 URL·metadata·로그인·비회원/회원 참여·이미지 공개 범위 smoke test.
7. 연락·권리 요청·운영 대응이 가능한 상태를 확인한 후 외부 유입 시작.
