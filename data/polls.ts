// 전체 투표 데이터를 관리하는 중앙 파일입니다.
// 나중에 진짜 DB(MySQL, MongoDB 등)가 생기면 이 파일만 교체하면 됩니다.

export const POLLS = [
  {
    id: "car",
    title: "🚗 아반떼 신차 vs 그랜저 중고",
    options: ["아반떼 신차 (약 2,500만원)", "그랜저 중고 (약 2,500만원)"],
    participants: 1242,
    stats: [42, 58],
    officialFact: "실제 20대 통계에 따르면, 첫 차로 2,000만원 이상 지출 시 유지비 부담으로 인한 '카푸어' 발생 비율이 높아집니다."
  },
  {
    id: "phone",
    title: "📱 아이폰 vs 갤럭시",
    options: ["아이폰 최신형", "갤럭시 S시리즈"],
    participants: 856,
    stats: [65, 35],
    officialFact: "최근 갤럽 조사에 따르면 20대의 65% 이상이 스마트폰으로 아이폰을 사용하고 있는 것으로 나타났습니다."
  }
];