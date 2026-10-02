// Display copy only; existing filtering keys and DB mappings are unchanged.
export type CategoryPresentation = {
  label: string;
  description: string;
  intro: string;
  examples: readonly string[];
};

export const CATEGORY_PRESENTATION = {
  '연애·관계': {
    label: '연애·관계', description: '관계의 거리와 기준',
    intro: '연애·관계에서 사람들이 궁금해한 것들',
    examples: ['연락 텀', '이성 친구', '선물', '약속', '서로의 경계'],
  },
  '게임': {
    label: '게임', description: '플레이 취향과 습관',
    intro: '게임할 때 은근히 갈리는 선택들',
    examples: ['한 판 더', '파티 플레이', '채팅', '난이도', '구매 시점'],
  },
  '스포츠': {
    label: '스포츠', description: '응원과 운동 취향',
    intro: '스포츠를 즐기는 서로 다른 방법',
    examples: ['직관', '응원 방식', '운동 시간', '동호회', '기록과 즐거움'],
  },
  '음식': {
    label: '음식', description: '먹는 취향과 선택',
    intro: '음식 취향이 갈린 질문들',
    examples: ['메뉴 취향', '먹는 순서', '배달', '가격', '계절 음식'],
  },
  '엔터·콘텐츠': {
    label: '엔터·콘텐츠', description: '보고 듣는 취향',
    intro: '콘텐츠를 즐기는 나만의 방식',
    examples: ['몰아보기', '스포일러', '엔딩', '음악 취향', '시청 장소'],
  },
  'IT·제품': {
    label: 'IT·제품', description: '제품을 고르는 기준',
    intro: '매일 쓰는 기기, 사람들은 어떻게 고를까요?',
    examples: ['기기 선택', '알림', '사진 정리', '교체 주기', '개인정보'],
  },
  '라이프': {
    label: '라이프', description: '일상의 작은 선택',
    intro: '일상에서 문득 궁금해진 것들',
    examples: ['주말', '여행 계획', '생활 루틴', '정리', '취미'],
  },
  '가치관': {
    label: '가치관', description: '선택에 담긴 기준',
    intro: '정답은 없지만 생각은 갈리는 질문들',
    examples: ['소비·저축', '시간·돈', '편리함·원칙', '관계의 경계', '선택 기준'],
  },
  '데이터': {
    label: '데이터', description: '숫자로 보는 변화',
    intro: '사람들의 선택 뒤, 숫자로 보는 흐름',
    examples: ['물가', '인구', '인터넷 이용', '고용', '지역별 변화'],
  },
} as const satisfies Record<string, CategoryPresentation>;

export type InterestCategory = keyof typeof CATEGORY_PRESENTATION;

export const ALL_CATEGORY_PRESENTATION: CategoryPresentation = {
  label: '전체', description: '사소한 취향부터 선택의 기준까지',
  intro: '사람들이 요즘 궁금해한 것들',
  examples: ['관계', '게임', '먹는 취향', '일상', '선택 기준'],
};
