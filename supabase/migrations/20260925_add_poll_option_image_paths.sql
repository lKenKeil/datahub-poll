-- Optional image paths are stored alongside the existing option text array.
-- A NULL value means that the poll has no option images. When present, the
-- array must stay positionally aligned with polls.options.

do $$
declare
  existing_type text;
begin
  select c.udt_name
    into existing_type
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'polls'
    and c.column_name = 'option_image_paths';

  if existing_type is not null and existing_type <> 'jsonb' then
    raise exception using
      errcode = '42804',
      message = 'public.polls.option_image_paths already exists with a non-jsonb type.';
  end if;
end;
$$;

alter table public.polls
add column if not exists option_image_paths jsonb null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.polls'::regclass
      and constraint_row.conname = 'polls_option_image_paths_valid_check'
  ) then
    alter table public.polls
    add constraint polls_option_image_paths_valid_check
    check (
      case
        when option_image_paths is null then true
        when jsonb_typeof(option_image_paths) <> 'array' then false
        when jsonb_typeof(options) <> 'array' then false
        when jsonb_array_length(option_image_paths) <> jsonb_array_length(options) then false
        else not jsonb_path_exists(
          option_image_paths,
          '$[*] ? (@.type() != "string" && @.type() != "null")'
        )
      end
    ) not valid;
  end if;
end;
$$;

alter table public.polls
validate constraint polls_option_image_paths_valid_check;

comment on column public.polls.option_image_paths is
  'Optional Storage object paths aligned by index with polls.options; each item is a string or JSON null.';
