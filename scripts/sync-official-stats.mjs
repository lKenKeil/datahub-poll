/*
  Usage:
    SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... npm run sync:official-stats
*/

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const restBase = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function upsert(table, rows) {
  const response = await fetch(`${restBase}/${table}?on_conflict=id`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${table} upsert failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function fetchWorldBankIndicator(indicatorId) {
  const url = `https://api.worldbank.org/v2/country/KOR/indicator/${indicatorId}?format=json&per_page=20`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`World Bank fetch failed (${indicatorId}): ${response.status}`);
  }

  const payload = await response.json();
  const points = Array.isArray(payload?.[1]) ? payload[1] : [];
  const latest = points.find((row) => row?.value !== null && row?.value !== undefined);
  if (!latest) return null;

  return {
    value: Number(latest.value),
    year: String(latest.date),
  };
}

function toDateString(year) {
  return /^\d{4}$/.test(year) ? `${year}-12-31` : null;
}

function formatValue(value, indicatorId) {
  if (!Number.isFinite(value)) return "n/a";
  const normalized = Number(value);
  if (indicatorId === "SP.POP.TOTL") return normalized.toLocaleString("en-US");
  return normalized.toFixed(2);
}

async function main() {
  const now = new Date().toISOString();

  const sources = [
    {
      id: "world_bank",
      name: "World Bank Data",
      homepage_url: "https://data.worldbank.org/",
      license: "CC BY 4.0",
      country_code: "GLOBAL",
      is_active: true,
      created_at: now,
    },
    {
      id: "kosis",
      name: "Korean Statistical Information Service (KOSIS)",
      homepage_url: "https://kosis.kr/eng/",
      license: "Public statistics portal",
      country_code: "KR",
      is_active: true,
      created_at: now,
    },
    {
      id: "oecd",
      name: "OECD Data",
      homepage_url: "https://data.oecd.org/",
      license: "OECD Terms and Conditions",
      country_code: "GLOBAL",
      is_active: true,
      created_at: now,
    },
  ];

  await upsert("official_sources", sources);

  const indicators = [
    {
      id: "wb_kor_population_total",
      indicatorId: "SP.POP.TOTL",
      title: "대한민국 총인구 (World Bank)",
      category: "사회/경제",
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SP.POP.TOTL?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "population", "korea"],
    },
    {
      id: "wb_kor_internet_users_pct",
      indicatorId: "IT.NET.USER.ZS",
      title: "대한민국 인터넷 이용률 (% of population, World Bank)",
      category: "IT/테크",
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.NET.USER.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "internet", "korea"],
    },
    {
      id: "wb_kor_youth_unemployment_pct",
      indicatorId: "SL.UEM.1524.ZS",
      title: "대한민국 청년 실업률 (15-24, %, World Bank)",
      category: "사회/경제",
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SL.UEM.1524.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "employment", "korea", "youth"],
    },
  ];

  const statsRows = [];

  for (const item of indicators) {
    const latest = await fetchWorldBankIndicator(item.indicatorId);
    if (!latest) continue;

    statsRows.push({
      id: item.id,
      source_id: "world_bank",
      category: item.category,
      title: item.title,
      summary: `최신 관측값: ${formatValue(latest.value, item.indicatorId)} (기준연도 ${latest.year})`,
      source_url: item.source_url,
      methodology: item.methodology,
      observed_at: toDateString(latest.year),
      published_at: toDateString(latest.year),
      confidence_note: "원문 지표 정의와 측정 방식은 World Bank indicator metadata를 확인하세요.",
      tags: item.tags,
      metadata: {
        source: "world_bank_api",
        indicator_id: item.indicatorId,
        latest_value: latest.value,
        latest_year: latest.year,
      },
      is_verified: true,
      updated_at: now,
    });
  }

  // Curated entry placeholders for KR official portals (manually verifiable references)
  statsRows.push(
    {
      id: "kosis_portal_reference",
      source_id: "kosis",
      category: "학술/통계",
      title: "KOSIS 공식 통계 포털",
      summary: "국가승인통계 검색 및 시계열 비교를 위한 기본 포털 진입점",
      source_url: "https://kosis.kr/eng/",
      confidence_note: "세부 지표는 KOSIS 테이블 단위 URL로 추가 수집 권장",
      tags: ["kosis", "portal", "korea"],
      metadata: { source: "manual_curation" },
      is_verified: true,
      updated_at: now,
    },
    {
      id: "oecd_korea_data_reference",
      source_id: "oecd",
      category: "사회/경제",
      title: "OECD Data - Korea Country Profile",
      summary: "한국 관련 OECD 지표 탐색을 위한 국가 프로파일",
      source_url: "https://data.oecd.org/korea.htm",
      confidence_note: "실제 poll 연결 시 지표별 deep link 추가 권장",
      tags: ["oecd", "korea", "macro"],
      metadata: { source: "manual_curation" },
      is_verified: true,
      updated_at: now,
    },
  );

  await upsert("official_statistics", statsRows);
  console.log(`Synced official sources (${sources.length}) and statistics (${statsRows.length}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
