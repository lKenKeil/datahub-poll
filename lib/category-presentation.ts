// Display copy only; existing filtering keys and DB mappings are unchanged.
export type CategoryPresentation = {
  label: string;
  description: string;
  intro: string;
  examples: readonly string[];
};

export const CATEGORY_PRESENTATION = {
  '연애·관계': {
    label: '연애·관계', description: '연락·친구·약속에서 궁금한 기준',
    intro: '연애·관계에서 사람들이 궁금해한 것들',
    examples: ['연락 텀', '이성 친구', '선물', '약속', '서로의 경계'],
  },
  '게임': {
    label: '게임', description: '같이 플레이하는 방식과 게임 취향',
    intro: '게임할 때 은근히 갈리는 선택들',
    examples: ['한 판 더', '파티 플레이', '채팅', '난이도', '구매 시점'],
  },
  '스포츠': {
    label: '스포츠', description: '직관·응원·운동에서 갈리는 취향',
    intro: '스포츠를 즐기는 서로 다른 방법',
    examples: ['직관', '응원 방식', '운동 시간', '동호회', '기록과 즐거움'],
  },
  '음식': {
    label: '음식', description: '메뉴·먹는 순서·배달을 고르는 취향',
    intro: '음식 취향이 갈린 질문들',
    examples: ['메뉴 취향', '먹는 순서', '배달', '가격', '계절 음식'],
  },
  '엔터·콘텐츠': {
    label: '엔터·콘텐츠', description: '영화·드라마·음악을 즐기는 방식',
    intro: '콘텐츠를 즐기는 나만의 방식',
    examples: ['몰아보기', '스포일러', '엔딩', '음악 취향', '시청 장소'],
  },
  'IT·제품': {
    label: 'IT·제품', description: '기기·가격·디자인을 고르는 기준',
    intro: '매일 쓰는 기기, 사람들은 어떻게 고를까요?',
    examples: ['기기 선택', '알림', '사진 정리', '교체 주기', '개인정보'],
  },
  '라이프': {
    label: '라이프', description: '주말·여행·생활 루틴의 작은 선택',
    intro: '일상에서 문득 궁금해진 것들',
    examples: ['주말', '여행 계획', '생활 루틴', '정리', '취미'],
  },
  '가치관': {
    label: '가치관', description: '시간·돈·관계 사이에서 중요한 것',
    intro: '정답은 없지만 생각은 갈리는 질문들',
    examples: ['소비·저축', '시간·돈', '편리함·원칙', '관계의 경계', '선택 기준'],
  },
  '데이터': {
    label: '데이터', description: '물가·인구·고용에서 궁금한 변화',
    intro: '사람들의 선택 뒤, 숫자로 보는 흐름',
    examples: ['물가', '인구', '인터넷 이용', '고용', '지역별 변화'],
  },
} as const satisfies Record<string, CategoryPresentation>;

export type InterestCategory = keyof typeof CATEGORY_PRESENTATION;

type CategoryCreateExample = {
  question: string;
  options: readonly [string, string];
  description: string;
};

// Placeholder copy only. These examples never become submitted form values.
export const CATEGORY_CREATE_EXAMPLES = {
  '연애·관계': {
    question: '예: 연인이 답장 텀이 3시간이면?',
    options: ['예: 바쁘면 그럴 수 있다', '예: 조금 서운할 것 같다'],
    description: '예: 서로 일하는 시간대는 비슷하다고 가정해주세요.',
  },
  '게임': {
    question: '예: 친구와 게임할 때 실력 차이가 크면?',
    options: ['예: 그래도 같이 한다', '예: 각자 비슷한 실력끼리 한다'],
    description: '예: 둘 다 즐겁게 플레이하는 게 목표라고 가정해주세요.',
  },
  '스포츠': {
    question: '예: 야구장 갈 때 더 중요한 건?',
    options: ['예: 경기 결과', '예: 현장 분위기'],
    description: '예: 같은 팀의 홈경기를 보러 간다고 가정해주세요.',
  },
  '음식': {
    question: '예: 야식 하나만 고른다면?',
    options: ['예: 치킨', '예: 피자'],
    description: '예: 가격과 양은 비슷하다고 가정해주세요.',
  },
  '엔터·콘텐츠': {
    question: '예: 드라마는 몰아보기 vs 매주 기다려 보기?',
    options: ['예: 완결 후 몰아본다', '예: 매주 기다려 본다'],
    description: '예: 같은 작품을 스포일러 없이 볼 수 있다고 가정해주세요.',
  },
  'IT·제품': {
    question: '예: 같은 성능이라면 디자인에 더 쓸까요?',
    options: ['예: 디자인에 더 쓴다', '예: 성능 같으면 싼 걸 산다'],
    description: '예: 성능과 내구성은 같고 디자인만 다르다고 가정해주세요.',
  },
  '라이프': {
    question: '예: 주말 하루가 비었다면?',
    options: ['예: 집에서 쉰다', '예: 밖에 나간다'],
    description: '예: 밀린 일 없이 자유롭게 쉴 수 있는 날이에요.',
  },
  '가치관': {
    question: '예: 시간을 아끼기 위해 돈을 더 쓸까요?',
    options: ['예: 시간이 더 중요하다', '예: 돈을 아끼는 게 중요하다'],
    description: '예: 택시를 타면 30분을 아끼지만 만 원을 더 써요.',
  },
  '데이터': {
    question: '예: 생활비 변화를 볼 때 더 궁금한 숫자는?',
    options: ['예: 내가 자주 사는 품목 가격', '예: 전체 평균 물가 변화'],
    description: '예: 정답을 맞히는 질문이 아니라, 더 알고 싶은 정보를 골라주세요.',
  },
} as const satisfies Record<InterestCategory, CategoryCreateExample>;

export const ALL_CATEGORY_PRESENTATION: CategoryPresentation = {
  label: '전체', description: '사소한 취향부터 선택의 기준까지',
  intro: '사람들이 요즘 궁금해한 것들',
  examples: ['관계', '게임', '먹는 취향', '일상', '선택 기준'],
};
