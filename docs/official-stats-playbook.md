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
