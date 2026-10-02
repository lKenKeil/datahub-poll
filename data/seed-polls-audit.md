# Askio 초기 질문 풀 큐레이션

검토일: 2026-10-02. Production 조회와 dry-run만 실행했으며 DB/Storage 쓰기는 하지 않았다.

## 기존 콘텐츠

- 운영 DB: 40개. 이 중 seed 30개, `custom_*` 4개, `official_*` 2개, 기타 legacy 4개.
- 정적 fallback: `data/polls.ts`의 자동차/스마트폰 질문 2개. DB에도 같은 주제가 있어 독립 질문으로 중복 집계하지 않는다.
- seed 30개의 ID, 내용, 카테고리, edit-lock 설정은 모두 보존했다.
- 활동이 있는 seed는 3개: `food-chicken-style`, `entertainment-cinema-home`, `entertainment-series-timing`. 투표/댓글을 변경하지 않았다.

### 중복 주제: 3개 그룹

| 주제 | 기존 위치 | 판단 |
| --- | --- | --- |
| 아반떼 신차/그랜저 중고 | DB `car`, `official_car`, 정적 `car` | 같은 비교 주제. 신규 질문으로 추가하지 않음 |
| 아이폰/갤럭시 | DB `phone`, `official_phone`, seed `tech-iphone-galaxy`, 정적 `phone` | 모델 표현은 다르지만 사실상 같은 선호 질문 |
| 짜장면/짬뽕 | DB `poll_1775631395548`, `poll_1775632321051`, seed `food-jjajang-jjamppong` | 순서가 반대인 항목도 같은 주제 |

DB 8개가 위 3개 주제를 공유한다. 중복을 단순히 합치거나 삭제하지 않는다. 기존 결과와 댓글이 있기 때문이다.

### 사용자 콘텐츠 운영 검토 후보: 3개

| ID | 제목 | 검토 이유 |
| --- | --- | --- |
| `custom_1775721338769_slwlj` | 🔥 엠타 vs 현석 | 특정 개인 비교처럼 보이나 맥락 불명확. 운영자가 검토해야 함 |
| `custom_1775721344456_mss6l` | 🔥 12323132 | 숫자만 있어 질문 의도 불명확 |
| `custom_e298ed0f-e0b9-4ff8-b075-ed915b1cc327` | 비상구 vs 개돼지 | 선택 의미가 불명확하고 비하 표현 검토 필요 |

모두 수정/숨김/삭제하지 않았다. 사용자 콘텐츠 판정은 자동 처리하지 않는다.

### 기존 seed 보완 검토 후보: 7개

- `game-story-or-competition`: 평생 한 게임만이라는 가정이 다소 인위적이다.
- `food-jjajang-jjamppong`, `tech-iphone-galaxy`: 운영 DB와 중복 주제다.
- `food-cold-noodles`, `sports-football-baseball`: 빠른 첫 선택에는 좋지만 이유를 나눌 맥락은 약하다.
- `food-bungeoppang-first-bite`: 가벼운 습관 질문으로 유지하되 같은 형식을 많이 늘리지 않는다.
- `food-chicken-style`: 기본 취향 질문이며 이미 투표/댓글이 있어 보존한다.

즉시 제외/삭제한 seed는 0개다. 위 7개는 저품질 확정이 아니라 후속 편집 우선 검토 목록이다.

기존 질문 중 명확한 정답이 있는 지식 퀴즈는 확인하지 못했다. 다만 정적 공식 비교의 통계/해설에는 출처 확인이 필요하므로 이번 일반 질문 확충의 근거로 사용하지 않았다.

## 준비한 질문 풀

총 90개 = 기존 30개 + 신규 60개. 실제 Production seed는 아직 30개다.

| 기존 표시용 interestCategory | 기존 | 신규 | 합계 |
| --- | ---: | ---: | ---: |
| 연애·관계 | 5 | 10 | 15 |
| 게임 | 4 | 6 | 10 |
| 음식 | 5 | 10 | 15 |
| 스포츠 | 4 | 4 | 8 |
| IT·제품 | 4 | 8 | 12 |
| 엔터·콘텐츠 | 4 | 6 | 10 |
| 라이프/가치관 | 4 | 16 | 20 |
| 합계 | 30 | 60 | 90 |

라이프/가치관 20개는 편집 주제상 일상 12개, 소비/가치관 8개다. DB category와 UI label은 변경하지 않았다. `interestCategory`는 seed 편집 메타데이터이며 DB에 저장되지 않는다. 실제 홈 분류는 기존 제목/선택지/DB category 기반 로직을 유지하므로 위 표와 정확히 같지는 않을 수 있다. 데이터/공식 통계 수를 억지로 채우지 않았다.

## 품질 기준과 수동 유사도 검토

관계 경계선, 온라인 예절, 생활 습관, 소비 기준, 콘텐츠 감상 방식, 제품 편의성 등 서로 다른 판단 축을 섞었다. 정답 퀴즈, 시사성 뉴스, 고위험 조언, 개인 공격, 자극적인 극단 가정, 광고는 신규 풀에서 제외했다. 설명은 조건 통일이 필요한 신규 3개에만 추가했다.

정규화한 제목의 완전 중복은 0개다. 문자 2-gram Jaccard 0.30 이상 후보도 0개였다. 이 검사는 의미 중복을 보장하지 않으므로 다음 주제는 별도로 읽고 검토했다.

| 가까운 주제 | 구분해서 유지한 이유 |
| --- | --- |
| `relationship-private-story` / `relationship-advice-style` | 사생활 공유 경계와 상담 방식은 다른 판단 축 |
| `relationship-birthday-gift` / `value-unwanted-gift` | 선물을 고르는 사람과 받는 사람의 상황을 구분 |
| `game-new-release-timing` / `entertainment-webtoon-release` | 게임 구매 할인과 연재 공개 대기의 다른 소비 맥락 |
| `tech-notification-style` / `tech-notification-group` | 답장 예절과 앱 알림 설정을 구분 |
| `food-bungeoppang-first-bite` / `food-chicken-leg-timing` | 먹는 부위 습관과 좋아하는 부분을 남기는 순서를 구분 |
| `life-weekend-style` / `life-rest-break` / `life-day-off-routine` | 활동 장소, 짧은 휴식, 휴일 시간표의 서로 다른 축 |
| `sports-goal-style` / `sports-hobby-competition` | 개인 운동 목표와 모임의 목적을 구분 |

추가한 60개를 최종 수동 리뷰했다. 제목은 최대 32 Unicode code point, 전체 제목 최대 35, 선택지 최대 17이다. 2개 선택지 89개, 3개 선택지 1개이며 전체 설명은 4개다. 질문 작성 순서도 주제를 번갈아 배치했지만 실제 홈 노출 순서를 보장하는 것은 아니다. ranking/추천/정렬은 변경하지 않았다.

## seed 실행 안전성

- ID: 기존 `seed_v1_<seedKey>` 체계 유지. 기존 30개 key/내용을 HEAD와 비교해 동일함을 확인했다.
- 생성: 기존 ID는 내용 충돌 검사 후 유지하며, 없는 ID만 `ignoreDuplicates: true`로 추가한다. 실제 투표/댓글은 덮어쓰지 않는다.
- sync: 활동 없는 기존 seed만 원자적 RPC 재검증 후 변경한다. 없는 항목은 생성하지 않는다. 이번 dry-run은 `unchanged=30`, `safe-to-update=0`, `blocked-by-activity=0`, `missing=60`이었다. 활동 seed도 내용이 같아 unchanged로 분류된다.
- 기본은 dry-run. hosted 프로젝트 apply에는 `--confirm-production`이 추가로 필요하다.
- 소유권 token/이미지/가짜 투표는 추가하지 않는다. seed 관리는 기존 관리자 경로를 사용한다.
- 기존 remove 스크립트는 activity 보호를 보장하지 않으므로 활동 seed의 삭제 수단으로 자동 실행하지 않는다. 이번 작업에서 삭제는 실행하지 않았다.

검증 명령:

```sh
npm run seed:polls -- --dry-run
npm run seed:polls:sync -- --dry-run
```

운영 반영을 별도로 승인한 뒤에만 사용할 명령:

```sh
npm run seed:polls -- --apply --confirm-production
```

새 질문은 seed 생성 명령으로 추가한다. sync는 신규 60개를 생성하지 않으므로 이번 확충에 필요하지 않다.

## 다음 콘텐츠 아이디어

답장/온라인 공유 경계, 함께 사는 생활 기준, 작은 소비 선택, 작품 감상 방식 같은 상황형 질문을 우선 확장한다. 실제 의견에서 이유가 풍부했던 질문의 판단 축을 참고하되 같은 문장만 바꿔 재생산하지 않는다. 공식 통계 비교는 출처와 기준 시점을 검증하는 별도 후속 기획으로 남긴다.

90개 풀 자체는 10~20개를 이어 봐도 관계/생활/음식/콘텐츠/소비의 서로 다른 이유를 만날 수 있다. 단, 현재 홈의 선택/정렬 방식과 운영의 중복 legacy 항목 때문에 실제 노출 다양성까지 보장할 수는 없다. 운영 반영 후 실제 홈 묶음을 관찰하는 것이 다음 확인 항목이다.
