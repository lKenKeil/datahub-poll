import type { Metadata } from 'next';
import { PolicyContact, PolicyDocument, PolicyEmailLink, PolicySection } from '@/components/policy-document';
import { BRAND } from '@/lib/brand';
import { SERVICE_POLICIES } from '@/lib/service-policies';

export const metadata: Metadata = {
  title: { absolute: SERVICE_POLICIES.terms.title },
  description: SERVICE_POLICIES.terms.description,
  alternates: { canonical: SERVICE_POLICIES.terms.canonical },
};

export default function TermsPage() {
  return (
    <PolicyDocument title="서비스 이용약관" introduction={`${BRAND.name}에서 질문하고 선택하며 서로의 이유를 나누기 위한 이용 기준을 안내합니다.`}>
      <PolicySection id="purpose" title="1. 목적">
        <p>이 약관은 {BRAND.name}의 운영자와 이용자 사이의 서비스 이용 기준 및 콘텐츠 운영 원칙을 정하는 것을 목적으로 합니다.</p>
      </PolicySection>
      <PolicySection id="definitions" title="2. 용어">
        <p>이용자는 서비스를 방문하거나 사용하는 사람, 회원은 로그인 계정을 사용하는 사람, 비회원은 계정 로그인 없이 사용하는 사람을 말합니다. 이용자 콘텐츠는 질문·선택지·설명·이미지·댓글·답글 등 이용자가 올린 내용을 말합니다.</p>
      </PolicySection>
      <PolicySection id="service" title="3. 서비스 내용">
        <p>서비스는 질문 탐색·검색, 선택과 결과 확인, 댓글·답글·반응, 질문 작성·관리, 프로필 및 활동 확인, 신고와 운영 검토 기능을 제공합니다. 별도 공식 출처의 통계 탐색 콘텐츠도 제공합니다.</p>
      </PolicySection>
      <PolicySection id="access" title="4. 회원과 비회원 이용">
        <p>읽기·검색·결과 열람은 로그인 없이 가능합니다. 비회원도 투표·댓글·답글·반응·신고에 참여할 수 있고, 질문 작성과 계정 프로필 기능에는 로그인이 필요합니다. 제공되는 기능과 작성 제한은 각 화면의 안내를 따릅니다.</p>
        <p>비회원 활동은 브라우저 저장정보에 연결될 수 있습니다. 저장정보 삭제나 다른 브라우저 이용으로 활동 연결·관리 접근이 달라질 수 있습니다. 로그인 상태의 익명 작성은 공개 이름을 감추는 방식이며 운영자에게까지 계정이 익명화되는 것은 아닙니다.</p>
      </PolicySection>
      <PolicySection id="account" title="5. 계정과 로그인">
        <p>Google·카카오 또는 이메일 인증번호로 로그인할 수 있으며, 처음 인증하는 경우 계정이 생성될 수 있습니다. 타인의 계정·이메일을 무단 사용하지 말고 로그인 세션과 질문 관리용 토큰을 안전하게 관리해주세요. 로그인 제공자의 정책이나 장애로 이용이 제한될 수 있습니다.</p>
        <p>공개 닉네임은 자동 생성 후 변경할 수 있고 소셜 로그인 이름을 강제로 공개하지 않습니다. 현재 직접 계정 탈퇴 화면은 없습니다. 계정 정보의 열람·정정·삭제 관련 요청은 <PolicyEmailLink />로, 그 밖의 계정 이용 문의는 <PolicyEmailLink kind="support" />로 보내주세요. 필요한 본인 확인과 처리 범위 검토를 거쳐 안내합니다.</p>
      </PolicySection>
      <PolicySection id="questions" title="6. 질문 작성과 관리">
        <p>질문은 서비스의 제목·선택지·이미지 등 입력 기준에 맞게 작성해주세요. 작성자에게 제공되는 관리 권한과 서버의 권한 확인에 따라 수정·삭제할 수 있습니다. 질문의 수정 잠금 조건이나 댓글 존재 여부에 따라 질문·선택지·이미지 변경이 제한될 수 있습니다.</p>
        <p>구조 변경이 허용된 구간에서 이미 참여가 있는 질문·선택지·이미지를 바꾸면 기존 투표가 초기화될 수 있습니다. 분류·설명 변경은 별도 기준을 따릅니다. 관리용 브라우저 정보가 사라진 경우 기존 소유자 토큰 방식의 권한을 복구해준다고 보장하지 않습니다.</p>
      </PolicySection>
      <PolicySection id="opinions" title="7. 댓글·답글·반응">
        <p>다른 이용자가 왜 그렇게 생각하는지 존중하며 의견을 나눠주세요. 댓글·답글·반응은 해당 기능의 검증·요청 제한을 따릅니다. 익명 기능을 사용해도 금지행위 기준은 동일하게 적용되며 본문에 스스로 적은 개인정보는 자동으로 가려지지 않습니다.</p>
      </PolicySection>
      <PolicySection id="voting" title="8. 투표 참여와 중복 제한">
        <p>비로그인과 로그인 모두 투표할 수 있고, 허용된 범위에서 선택을 바꿀 수 있습니다. 중복 참여를 줄이기 위한 브라우저·계정 기준을 사용하며 로그인할 때 기존 브라우저 투표가 계정에 연결될 수 있습니다. 다른 계정에 연결된 참여는 변경이 제한될 수 있습니다.</p>
        <p>실제 사람 한 명당 한 표를 모든 환경에서 완벽히 보장하는 방식은 아닙니다. 여러 계정·브라우저·자동화 등으로 투표나 반응을 의도적으로 조작하는 행위는 허용되지 않습니다.</p>
      </PolicySection>
      <PolicySection id="results" title="9. 투표 결과의 성격">
        <p>투표 결과는 {BRAND.name} 이용자의 자발적 참여를 모은 결과입니다. 과학적 여론조사나 대표 표본 조사가 아니며, 특정 집단 또는 전체 사회의 의견을 대표한다고 보장하지 않습니다. 결과만으로 중요한 의사결정을 내리기보다 참여 규모와 질문 맥락을 함께 살펴주세요.</p>
      </PolicySection>
      <PolicySection id="user-content" title="10. 이용자 콘텐츠">
        <p>게시한 내용은 다른 이용자에게 공개될 수 있습니다. 자신이 게시할 권한이 있는 내용만 올리고 타인의 개인정보·이미지·저작물을 사용할 때 필요한 권한을 확인해주세요. 익명 표시나 사진 공개 설정은 이미 알려진 공개 이미지 URL의 접근을 철회하는 기능이 아닙니다.</p>
      </PolicySection>
      <PolicySection id="prohibited" title="11. 금지행위">
        <ul className="list-disc space-y-2 pl-5">
          <li>불법 콘텐츠 게시, 타인의 저작권·명예 등 권리 침해, 동의 없는 개인정보 노출</li>
          <li>광고·스팸·반복 도배, 사칭, 괴롭힘·위협 또는 차별적 공격</li>
          <li>투표·반응·신고 조작, 반복적인 허위 신고, 권한 우회 및 타인의 관리정보 사용</li>
          <li>서비스를 방해하는 자동화·비정상 요청, 보안 침해 또는 데이터 무단 접근</li>
        </ul>
      </PolicySection>
      <PolicySection id="reports" title="12. 신고와 운영 검토">
        <p>질문·댓글·답글의 광고·도배, 욕설·괴롭힘, 부적절한 내용, 개인정보 노출 등을 신고할 수 있습니다. 운영자는 신고 사유와 콘텐츠를 확인하여 숨김·복구·삭제 또는 신고 처리 결정을 할 수 있습니다. 신고 수만으로 자동 숨김 처리하거나 모든 신고가 즉시 처리된다고 보장하지 않습니다.</p>
      </PolicySection>
      <PolicySection id="moderation" title="13. 숨김·삭제와 요청 제한">
        <p>금지행위, 권리 침해, 법령상 필요 또는 운영 검토가 필요한 콘텐츠는 숨기거나 삭제할 수 있습니다. 숨김은 일반 공개 화면에서 비노출하는 조치이며 검토 후 복구할 수 있습니다. 삭제는 콘텐츠와 관련 데이터를 정리하는 최종 조치로 복구를 보장하지 않습니다.</p>
        <p>삭제 시 관련 댓글·답글·반응·투표 등이 함께 정리될 수 있고, 업로드 이미지는 기존 저장소 정리 절차를 사용합니다. 공개 URL을 이미 알고 있는 경우 숨김만으로 파일 접근이 차단되지 않으며, 삭제 뒤에도 외부 캐시 등에 잠시 남을 수 있습니다.</p>
        <p>반복 요청에는 일시적인 요청 제한을 적용합니다. 현재 자동 계정 차단 기능은 제공하지 않습니다. 운영 조치에 대한 문의·검토 요청은 <PolicyEmailLink kind="support" />로 보내주세요. 관련 콘텐츠와 문의 내용을 확인하여 안내합니다.</p>
      </PolicySection>
      <PolicySection id="availability" title="14. 서비스 변경과 중단">
        <p>점검, 장애, 보안 문제, 외부 제공자의 사정 또는 운영상 필요로 기능이 변경되거나 중단될 수 있습니다. 중요한 변경은 서비스 안내를 통해 알리는 것을 원칙으로 하며 긴급한 경우 사후 안내가 필요할 수 있습니다. 지속적인 제공이나 데이터 복구를 무조건 보장하지 않습니다.</p>
      </PolicySection>
      <PolicySection id="official-data" title="15. 공식 출처 데이터">
        <p>World Bank 등 외부 공식 출처의 통계를 원 출처와 함께 표시하고 편의상 요약·시각화할 수 있습니다. 이를 {BRAND.name}이 직접 작성한 공식 통계로 보아서는 안 됩니다. 자료의 기준 시점·갱신·누락·집계 기준은 원 출처를 확인해주세요.</p>
        <p>표시된 비교나 요약은 자료를 이해하기 위한 것으로 인과관계나 미래 예측을 보장하지 않습니다. 원자료의 이용 조건과 출처 표기를 확인해야 합니다.</p>
      </PolicySection>
      <PolicySection id="rights" title="16. 지식재산권과 이용 허락">
        <p>이용자가 작성한 콘텐츠의 권리는 해당 이용자 또는 원 권리자에게 남습니다. 서비스가 이를 과도하게 양도받는 것으로 해석하지 않습니다. 게시한 콘텐츠는 서비스 운영에 필요한 범위에서 저장·표시·전송하고, 이미지 형식 변환 등 제공에 필요한 기술적 처리를 할 수 있도록 허락하는 것을 기준으로 합니다.</p>
        <p>이 허락은 서비스 제공에 필요한 범위를 넘는 판매나 독립적 상업 활용까지 포괄하지 않습니다. 서비스의 자체 디자인·로고·프로그램과 외부 제공 자료의 권리는 각 권리자에게 있으며 별도 이용에는 해당 조건이 적용됩니다.</p>
      </PolicySection>
      <PolicySection id="liability" title="17. 책임의 범위">
        <p>이용자 콘텐츠의 정확성·적법성 및 투표 결과의 대표성을 무조건 보장하지는 않습니다. 다만 이 문구가 운영자의 고의·과실에 따른 책임이나 법령상 부담하는 책임을 일률적으로 면제하는 것은 아닙니다. 각자의 책임은 적용 법령과 구체적인 사정에 따라 판단합니다.</p>
      </PolicySection>
      <PolicySection id="privacy" title="18. 개인정보와 약관 변경">
        <p>개인정보 처리 내용은 개인정보처리방침을 함께 확인해주세요. 약관을 변경할 때에는 내용과 시행일을 알리고, 법령상 별도 안내·동의가 필요한 경우 해당 절차를 따릅니다. 단순히 로그인 버튼을 누르거나 정책 링크가 표시된 것만으로 필요한 법적 동의 절차를 모두 마쳤다고 보지 않습니다.</p>
      </PolicySection>
      <PolicySection id="contact" title="19. 문의">
        <PolicyContact />
      </PolicySection>
      <PolicySection id="effective-date" title="20. 시행일">
        <p>이 이용약관은 {SERVICE_POLICIES.effectiveDateLabel}부터 시행합니다.</p>
      </PolicySection>
    </PolicyDocument>
  );
}
