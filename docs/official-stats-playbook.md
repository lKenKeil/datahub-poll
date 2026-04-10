# Official Stats Playbook

## 1) Source-first collection
- Only ingest from explicit source IDs in `official_sources`.
- Keep one canonical `source_url` for every record in `official_statistics`.
- Save `observed_at` and `published_at` separately.

## 2) Minimum quality checks
- Reject rows without `source_url`.
- Reject rows without `title` or `category`.
- Require one of: `sample_size`, `methodology`, or `confidence_note`.
- Mark `is_verified=false` if confidence is unclear.

## 3) Suggested source onboarding order
- Korea: KOSIS / 통계청
- Global: OECD, World Bank, UNData
- Tech trends: StatCounter, GSMA (when methodology is public)

## 4) Poll linkage strategy
- Convert one statistic to one poll prompt.
- Keep a backlink from poll to statistic ID in `polls.metadata` (next step).
- Show `source_url` and `observed_at` on the poll detail page.

## 5) Update cadence
- Nightly sync for fast-changing sources.
- Weekly sync for static/public annual datasets.

## 6) Automated sync (implemented)
- Script: `scripts/sync-official-stats.mjs`
- Command:
  - `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run sync:official-stats`
- Current auto-collected indicators:
  - IT/테크: `IT.NET.USER.ZS`, `IT.CEL.SETS.P2`, `IT.NET.BBND.P2`
  - 사회/경제: `SP.POP.TOTL`, `NY.GDP.PCAP.CD`, `FP.CPI.TOTL.ZG`, `SL.UEM.1524.ZS`, `SL.UEM.TOTL.ZS`
  - 라이프스타일: `SP.DYN.LE00.IN`, `EN.ATM.PM25.MC.M3`, `SP.DYN.TFRT.IN`
  - 학술/통계: `GB.XPD.RSDV.GD.ZS`, `SE.XPD.TOTL.GD.ZS`
  - 글로벌 비교: `IT.NET.USER.ZS` 기준 상위 국가 Top10

## 7) Recommended institution queue (KR first)
- KOSIS table-level links (official Korean statistics)
- Statistics Korea press releases with publication date and sample notes
- OECD Korea deep links per indicator
- Add each record with:
  - `source_url`
  - `observed_at`
  - `published_at`
  - `methodology` or `confidence_note`
