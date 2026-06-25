
create or replace function public.session_attendance_join(_session_id uuid, _user_name text, _role text)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sessions;
  ls jsonb;
  att jsonb;
  has_open boolean;
begin
  select * into s from public.sessions where id = _session_id for update;
  if not found then raise exception 'session % not found', _session_id; end if;
  ls := coalesce(s.learning_summary, '{}'::jsonb);
  att := coalesce(ls->'attendance', '[]'::jsonb);
  if jsonb_typeof(att) <> 'array' then att := '[]'::jsonb; end if;

  select exists (
    select 1 from jsonb_array_elements(att) a
    where (a->>'userName') = _user_name and coalesce(a->>'leftAt','') = ''
  ) into has_open;

  if not has_open then
    att := att || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'userName', _user_name,
      'role', _role,
      'joinedAt', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'leftAt', '',
      'durationMinutes', 0
    ));
  end if;

  ls := jsonb_set(ls, '{attendance}', att, true);
  update public.sessions
    set learning_summary = ls,
        status = case when status = 'Completed' then status else 'Ongoing' end
    where id = _session_id
    returning * into s;
  return s;
end$$;

grant execute on function public.session_attendance_join(uuid, text, text) to authenticated;

create or replace function public.session_attendance_leave(_session_id uuid, _user_name text)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sessions;
  ls jsonb;
  att jsonb;
  now_iso text;
begin
  select * into s from public.sessions where id = _session_id for update;
  if not found then raise exception 'session % not found', _session_id; end if;
  ls := coalesce(s.learning_summary, '{}'::jsonb);
  att := coalesce(ls->'attendance', '[]'::jsonb);
  if jsonb_typeof(att) <> 'array' then att := '[]'::jsonb; end if;
  now_iso := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  select coalesce(jsonb_agg(
    case
      when (a->>'userName') = _user_name and coalesce(a->>'leftAt','') = ''
        then a
          || jsonb_build_object('leftAt', now_iso)
          || jsonb_build_object('durationMinutes',
              round((extract(epoch from (now() - (a->>'joinedAt')::timestamptz)) / 60.0)::numeric, 2))
      else a
    end
  ), '[]'::jsonb)
  into att
  from jsonb_array_elements(att) a;

  ls := jsonb_set(ls, '{attendance}', att, true);
  update public.sessions
    set learning_summary = ls
    where id = _session_id
    returning * into s;
  return s;
end$$;

grant execute on function public.session_attendance_leave(uuid, text) to authenticated;
