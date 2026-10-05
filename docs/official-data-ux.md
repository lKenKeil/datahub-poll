# Official data exploration

- Home's data category shows the existing verified official-statistics response
  directly, without the poll Hero/popular/rising/latest feed. Other category
  discovery and ranking algorithms are unchanged. The API's existing eight-row
  limit is retained (other home categories still preview six matching rows).
- Home and data detail reuse `SiteHeader`. A data-detail search submits `q` to
  the existing home filter; `?category=data` returns to the data landing.
- Existing metadata/series/ranking values are read only. Annual metadata is
  labelled as an observation year, not a real December 31 publication date.
- Numeric parsing rejects null, blanks, booleans and non-finite values; real zero
  is preserved. Incomplete latest metadata is not paired with an older value.
- Summaries use actual observations. Only an adjacent previous year is called
  'last year'; gaps are labelled as previous observations. Percentage differences
  use percentage points. Display values are rounded to two decimals; differences
  are calculated before rounding, which can differ from subtracting display values.
- Trend summaries consider at most five recent observations (not necessarily
  five consecutive years). A rise/fall needs at least 75% same-direction steps
  and a net change at least half the observed range. Flat observations and small
  fluctuations are distinguished from larger alternating changes. No causal
  explanation, forecast, statistical significance or LLM/API interpretation.
- Time series use a responsive accessible SVG line chart with a real year axis,
  readable tick labels, all data points, latest-point emphasis and pointer/keyboard
  tooltips. A semantic year/value table remains. Empty/single-year data has no line.
  Ranking data retains a ranked list and never becomes a fabricated time series.
- Summary and source/methodology are separate. Existing source links and notes
  are retained. No new dependency, migration, ingestion, analytics or mutation.

Verification: `node scripts/test-official-statistics.mjs`, existing API/auth and
discovery regressions, lint, TypeScript and production build. Browser QA uses
read-only local production rendering with existing data; never creates activity.
