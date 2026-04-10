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

const KR_ACADEMIC = "\uD559\uC220/\uD1B5\uACC4"; // 학술/통계
const KR_TECH = "IT/\uD14C\uD06C"; // IT/테크
const KR_SOCIO = "\uC0AC\uD68C/\uACBD\uC81C"; // 사회/경제
const KR_LIFESTYLE = "\uB77C\uC774\uD504\uC2A4\uD0C0\uC77C"; // 라이프스타일

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

function normalizeOfficialStatisticsRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    source_id: row.source_id,
    category: row.category,
    title: row.title,
    summary: row.summary ?? null,
    source_url: row.source_url,
    methodology: row.methodology ?? null,
    sample_size: row.sample_size ?? null,
    observed_at: row.observed_at ?? null,
    published_at: row.published_at ?? null,
    confidence_note: row.confidence_note ?? null,
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    is_verified: row.is_verified ?? true,
    updated_at: row.updated_at ?? new Date().toISOString(),
  }));
}

async function fetchWorldBankSeriesByCountry(indicatorId, countryCode = "KOR") {
  const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicatorId}?format=json&per_page=60`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`World Bank fetch failed (${indicatorId}, ${countryCode}): ${response.status}`);
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
  const recentSeries = cleaned.slice(-10);
  return { latest, series: recentSeries };
}

async function fetchWorldBankGlobalTopCountries(indicatorId, topN = 10) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicatorId}?format=json&per_page=20000`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`World Bank global fetch failed (${indicatorId}): ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.[1]) ? payload[1] : [];

  const normalized = rows
    .map((row) => ({
      iso3: String(row?.countryiso3code ?? ""),
      country: String(row?.country?.value ?? ""),
      year: String(row?.date ?? ""),
      value: typeof row?.value === "number" ? row.value : Number(row?.value),
    }))
    .filter((row) => /^[A-Z]{3}$/.test(row.iso3) && /^\d{4}$/.test(row.year) && Number.isFinite(row.value));

  if (normalized.length === 0) return null;

  const latestYear = normalized.reduce((max, row) => (Number(row.year) > max ? Number(row.year) : max), 0);
  const latestRows = normalized
    .filter((row) => Number(row.year) === latestYear)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);

  return {
    year: String(latestYear),
    top: latestRows.map((row, idx) => ({
      rank: idx + 1,
      country: row.country,
      iso3: row.iso3,
      value: row.value,
    })),
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
  if (indicatorId === "SL.UEM.TOTL.ZS") return `${num.toFixed(2)}%`;
  if (indicatorId === "IT.CEL.SETS.P2") return `${num.toFixed(2)} / 100명`;
  if (indicatorId === "IT.NET.BBND.P2") return `${num.toFixed(2)} / 100명`;
  if (indicatorId === "NY.GDP.PCAP.CD") return `$${Math.round(num).toLocaleString("en-US")}`;
  if (indicatorId === "FP.CPI.TOTL.ZG") return `${num.toFixed(2)}%`;
  if (indicatorId === "SP.DYN.LE00.IN") return `${num.toFixed(2)}세`;
  if (indicatorId === "EN.ATM.PM25.MC.M3") return `${num.toFixed(2)} µg/m³`;
  if (indicatorId === "GB.XPD.RSDV.GD.ZS") return `${num.toFixed(2)}%`;
  if (indicatorId === "SE.XPD.TOTL.GD.ZS") return `${num.toFixed(2)}%`;
  if (indicatorId === "SP.DYN.TFRT.IN") return `${num.toFixed(2)}명`;
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
    // IT/테크
    {
      id: "wb_kor_internet_users_pct",
      indicatorId: "IT.NET.USER.ZS",
      title: "대한민국 인터넷 이용률 (World Bank)",
      category: KR_TECH,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.NET.USER.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "internet", "korea", "tech"],
    },
    {
      id: "wb_kor_mobile_subscriptions",
      indicatorId: "IT.CEL.SETS.P2",
      title: "대한민국 이동통신 가입건수 (100명당, World Bank)",
      category: KR_TECH,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.CEL.SETS.P2?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "mobile", "subscriptions", "korea", "tech"],
    },
    {
      id: "wb_kor_fixed_broadband",
      indicatorId: "IT.NET.BBND.P2",
      title: "대한민국 유선 초고속인터넷 가입건수 (100명당, World Bank)",
      category: KR_TECH,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/IT.NET.BBND.P2?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "broadband", "korea", "tech"],
    },

    // 사회/경제
    {
      id: "wb_kor_population_total",
      indicatorId: "SP.POP.TOTL",
      title: "대한민국 총인구 (World Bank)",
      category: KR_SOCIO,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SP.POP.TOTL?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "population", "korea", "economy"],
    },
    {
      id: "wb_kor_gdp_per_capita",
      indicatorId: "NY.GDP.PCAP.CD",
      title: "대한민국 1인당 GDP (현재 미달러, World Bank)",
      category: KR_SOCIO,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/NY.GDP.PCAP.CD?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "gdp", "korea", "economy"],
    },
    {
      id: "wb_kor_inflation_cpi",
      indicatorId: "FP.CPI.TOTL.ZG",
      title: "대한민국 소비자물가 상승률 (CPI, World Bank)",
      category: KR_SOCIO,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/FP.CPI.TOTL.ZG?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "inflation", "korea", "economy"],
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
    {
      id: "wb_kor_unemployment_total",
      indicatorId: "SL.UEM.TOTL.ZS",
      title: "대한민국 전체 실업률 (World Bank)",
      category: KR_SOCIO,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SL.UEM.TOTL.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "employment", "korea", "economy"],
    },

    // 라이프스타일
    {
      id: "wb_kor_life_expectancy",
      indicatorId: "SP.DYN.LE00.IN",
      title: "대한민국 기대수명 (World Bank)",
      category: KR_LIFESTYLE,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SP.DYN.LE00.IN?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "life", "health", "korea", "lifestyle"],
    },
    {
      id: "wb_kor_pm25_exposure",
      indicatorId: "EN.ATM.PM25.MC.M3",
      title: "대한민국 PM2.5 노출 농도 (World Bank)",
      category: KR_LIFESTYLE,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/EN.ATM.PM25.MC.M3?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "air", "pm25", "korea", "lifestyle"],
    },
    {
      id: "wb_kor_fertility_rate",
      indicatorId: "SP.DYN.TFRT.IN",
      title: "대한민국 합계출산율 (World Bank)",
      category: KR_LIFESTYLE,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SP.DYN.TFRT.IN?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "fertility", "korea", "lifestyle"],
    },

    // 학술/통계
    {
      id: "wb_kor_rnd_expenditure",
      indicatorId: "GB.XPD.RSDV.GD.ZS",
      title: "대한민국 연구개발비 (GDP 대비 %, World Bank)",
      category: KR_ACADEMIC,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/GB.XPD.RSDV.GD.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "rnd", "korea", "research", "academic"],
    },
    {
      id: "wb_kor_education_expenditure",
      indicatorId: "SE.XPD.TOTL.GD.ZS",
      title: "대한민국 교육지출 (GDP 대비 %, World Bank)",
      category: KR_ACADEMIC,
      source_url: "https://api.worldbank.org/v2/country/KOR/indicator/SE.XPD.TOTL.GD.ZS?format=json",
      methodology: "World Development Indicators",
      tags: ["worldbank", "education", "korea", "academic"],
    },
  ];

  const statsRows = [];

  for (const item of indicators) {
    const seriesData = await fetchWorldBankSeriesByCountry(item.indicatorId, "KOR");
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

  // 글로벌 비교형 지표 (IT/테크)
  const globalInternetTop = await fetchWorldBankGlobalTopCountries("IT.NET.USER.ZS", 10);
  if (globalInternetTop && globalInternetTop.top.length > 0) {
    const top3 = globalInternetTop.top.slice(0, 3);
    statsRows.push({
      id: "wb_global_internet_users_top10",
      source_id: "world_bank",
      category: KR_TECH,
      title: "전세계 인터넷 이용률 상위 국가 (World Bank)",
      summary: `${globalInternetTop.year}년 기준 Top3: ${top3
        .map((row) => `${row.rank}위 ${row.country} ${row.value.toFixed(2)}%`)
        .join(" / ")}`,
      source_url: "https://api.worldbank.org/v2/country/all/indicator/IT.NET.USER.ZS?format=json",
      methodology: "World Development Indicators (country-level latest year ranking)",
      observed_at: toDateString(globalInternetTop.year),
      published_at: toDateString(globalInternetTop.year),
      confidence_note: "국가별 최신 연도 동일 기준 비교를 적용했습니다.",
      tags: ["worldbank", "global", "internet", "ranking", "tech"],
      metadata: {
        source: "world_bank_api",
        indicator_id: "IT.NET.USER.ZS",
        latest_year: globalInternetTop.year,
        ranking_top10: globalInternetTop.top,
      },
      is_verified: true,
      updated_at: now,
    });
  }

  // 큐레이션 레퍼런스
  statsRows.push(
    {
      id: "kosis_portal_reference",
      source_id: "kosis",
      category: KR_ACADEMIC,
      title: "KOSIS 공식 통계 포털",
      summary: "국가승인통계 검색 및 시계열 비교를 위한 기본 포털 진입점",
      source_url: "https://kosis.kr/eng/",
      confidence_note: "세부 지표는 KOSIS 테이블 단위 URL로 추가 수집 권장",
      tags: ["kosis", "portal", "korea", "official"],
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
      tags: ["oecd", "korea", "macro", "official"],
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
      tags: ["cloudflare", "internet", "global", "quality", "official"],
      metadata: { source: "manual_curation" },
      is_verified: true,
      updated_at: now,
    },
  );

  const normalizedStatsRows = normalizeOfficialStatisticsRows(statsRows);
  await upsert("official_statistics", normalizedStatsRows);
  console.log(`Synced official sources (${sources.length}) and statistics (${statsRows.length}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
