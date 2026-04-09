insert into public.official_sources (id, name, homepage_url, license, country_code, is_active)
values
  ('world_bank', 'World Bank Data', 'https://data.worldbank.org/', 'CC BY 4.0', 'GLOBAL', true),
  ('kosis', 'Korean Statistical Information Service (KOSIS)', 'https://kosis.kr/eng/', 'Public statistics portal', 'KR', true),
  ('oecd', 'OECD Data', 'https://data.oecd.org/', 'OECD Terms and Conditions', 'GLOBAL', true)
on conflict (id) do update
set
  name = excluded.name,
  homepage_url = excluded.homepage_url,
  license = excluded.license,
  country_code = excluded.country_code,
  is_active = excluded.is_active;

insert into public.official_statistics (
  id,
  source_id,
  category,
  title,
  summary,
  source_url,
  confidence_note,
  tags,
  metadata,
  is_verified
)
values
  (
    'kosis_portal_reference',
    'kosis',
    '학술/통계',
    'KOSIS 공식 통계 포털',
    '국가승인통계 검색 및 시계열 비교를 위한 기본 포털 진입점',
    'https://kosis.kr/eng/',
    '세부 지표는 KOSIS 테이블 단위 URL로 추가 수집 권장',
    array['kosis', 'portal', 'korea'],
    '{"source":"seed_migration"}'::jsonb,
    true
  ),
  (
    'oecd_korea_data_reference',
    'oecd',
    '사회/경제',
    'OECD Data - Korea Country Profile',
    '한국 관련 OECD 지표 탐색을 위한 국가 프로파일',
    'https://data.oecd.org/korea.htm',
    '실제 poll 연결 시 지표별 deep link 추가 권장',
    array['oecd', 'korea', 'macro'],
    '{"source":"seed_migration"}'::jsonb,
    true
  )
on conflict (id) do update
set
  source_id = excluded.source_id,
  category = excluded.category,
  title = excluded.title,
  summary = excluded.summary,
  source_url = excluded.source_url,
  confidence_note = excluded.confidence_note,
  tags = excluded.tags,
  metadata = excluded.metadata,
  is_verified = excluded.is_verified,
  updated_at = now();
