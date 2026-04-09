/*
  Usage (PowerShell):
    $env:NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
    $env:SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
    npm run sync:official-stats
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

const KR_TECH = "IT/테크";
const KR_SOCIO = "사회/경제";
const KR_ACADEMIC = "학술/통계";

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

async function fetchWorldBankSeries(indicatorId) {
  const url = `https://api.worldbank.org/v2/country/KOR/indicator/${indicatorId}?format=json&per_page=40`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`World Bank fetch failed (${indicatorId}): ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.[1]) ? payload[1] : [];
  const cleaned = rows
    .map((row) => ({
      year: String(row?.date ?? ""),
      value: typeof row?.value === "number" ? row.value : Number(row?.value),
    }))
    .filter((row) => /^\d{4}$/.test(row.year) && Number.isFinite(row.value))
    .sort((a, b) => Number(a.year) - Number(b.year));

  const latest = cleaned.length > 0 ? cleaned[cleaned.length - 1] : null;
  const recentSeries = cleaned.slice(-8);

  return {
    latest,
    series: recentSeries,
  };
}

function toDateString(year) {
  return /^\d{4}$/.test(year) ? `${year}-12-31` : null;
}

function formatValue(value, indicatorId) {
  if (!Number.isFinite(value)) return "n/a";
  const num = Number(value);

  if (indicatorId === "SP.POP.TOTL") return `${Math.round(num).toLocaleString("en-US")} 명`;
  if (indicatorId === "IT.NET.USER.ZS") return `${num.toFixed(2)}%`;
  if (indicatorId === "SL.UEM.1524.ZS") return `${num.toFixed(2)}%`;
  if (indicatorId === "IT.CEL.SETS.P2") return `${num.toFixed(2)} / 100명`;
  if (indicatorId === "IT.NET.BBND.P2") return `${num.toFixed(2)} / 100명`;
  return Number.isInteger(num) ? num.toLocaleString("en-US") : num.toFixed(2);
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
    {
      id: "cloudflare_radar",
      name: "Cloudflare Radar",
      homepage_url: "https://radar.cloudflare.com/",
      license: "Cloudflare Radar terms",
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
      category: KR_SOCIO,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SP.POP.TOTL?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "population", "korea"],
    },
    {
      id: "wb_kor_internet_users_pct",
      indicatorId: "IT.NET.USER.ZS",
      title: "대한민국 인터넷 이용률 (World Bank)",
      category: KR_TECH,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.NET.USER.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "internet", "korea"],
    },
    {
      id: "wb_kor_mobile_subscriptions",
      indicatorId: "IT.CEL.SETS.P2",
      title: "대한민국 이동통신 가입건수 (100명당, World Bank)",
      category: KR_TECH,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.CEL.SETS.P2?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "mobile", "subscriptions", "korea"],
    },
    {
      id: "wb_kor_fixed_broadband",
      indicatorId: "IT.NET.BBND.P2",
      title: "대한민국 유선 초고속인터넷 가입건수 (100명당, World Bank)",
      category: KR_TECH,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.NET.BBND.P2?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "broadband", "korea"],
    },
    {
      id: "wb_kor_youth_unemployment_pct",
      indicatorId: "SL.UEM.1524.ZS",
      title: "대한민국 청년 실업률 (15-24세, World Bank)",
      category: KR_SOCIO,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SL.UEM.1524.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "employment", "korea", "youth"],
    },
  ];

  const statsRows = [];

  for (const item of indicators) {
    const seriesData = await fetchWorldBankSeries(item.indicatorId);
    if (!seriesData.latest) continue;

    const latest = seriesData.latest;

    statsRows.push({
      id: item.id,
      source_id: "world_bank",
      category: item.category,
      title: item.title,
      summary: `최신 관측값: ${formatValue(latest.value, item.indicatorId)} (${latest.year}년)`,
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
        series: seriesData.series,
      },
      is_verified: true,
      updated_at: now,
    });
  }

  statsRows.push(
    {
      id: "kosis_portal_reference",
      source_id: "kosis",
      category: KR_ACADEMIC,
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
      category: KR_SOCIO,
      title: "OECD Data - Korea Country Profile",
      summary: "한국 관련 OECD 지표 탐색을 위한 국가 프로파일",
      source_url: "https://data.oecd.org/korea.htm",
      confidence_note: "지표별 deep link를 계속 추가하면 탐색성이 좋아집니다.",
      tags: ["oecd", "korea", "macro"],
      metadata: { source: "manual_curation" },
      is_verified: true,
      updated_at: now,
    },
    {
      id: "cloudflare_global_internet_quality",
      source_id: "cloudflare_radar",
      category: KR_TECH,
      title: "Cloudflare Radar - Global Internet Quality",
      summary: "국가 단위 네트워크 품질/지연 지표를 탐색할 수 있는 글로벌 대시보드",
      source_url: "https://radar.cloudflare.com/quality",
      confidence_note: "순위형 콘텐츠 제작 시 동일 기간/동일 기준 비교를 유지하세요.",
      tags: ["cloudflare", "internet", "global", "quality"],
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
