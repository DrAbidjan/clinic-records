-- Clinic Patient Records – update for October 2026
--   1) Expenses, salaries and clinic logo   2) Online booking with QR code
-- Run this ONCE in Supabase → SQL Editor → New query → paste everything → Run.
-- Safe to run again. It only ADDS things; your clinics and patients are not touched.

-- Finance: expenses, staff & salaries, clinic branding (logo/background). Admin only, except branding which the whole team reads.
create table if not exists public.finance (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  kind        text not null check (kind in ('expense','staff','salary','branding')),
  data        jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists finance_clinic_idx on public.finance(clinic_id, kind);

alter table public.finance enable row level security;
drop policy if exists "finance: read"   on public.finance;
drop policy if exists "finance: add"    on public.finance;
drop policy if exists "finance: change" on public.finance;
drop policy if exists "finance: remove" on public.finance;
create policy "finance: read"   on public.finance for select using (public.is_member(clinic_id) and (kind = 'branding' or public.has_role(clinic_id, array['admin'])));
create policy "finance: add"    on public.finance for insert with check (public.has_role(clinic_id, array['admin']) and public.is_active(clinic_id));
create policy "finance: change" on public.finance for update using (public.has_role(clinic_id, array['admin']) and public.is_active(clinic_id)) with check (public.has_role(clinic_id, array['admin']));
create policy "finance: remove" on public.finance for delete using (public.has_role(clinic_id, array['admin']) and public.is_active(clinic_id));

-- Online booking: patients book a free time from the clinic's booking page (QR code). ---------------
alter table public.clinics add column if not exists booking      jsonb not null default '{}'::jsonb;
alter table public.clinics add column if not exists booking_code text;
create unique index if not exists clinics_booking_code_idx on public.clinics(booking_code) where booking_code is not null;

create table if not exists public.online_bookings (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  starts_at      timestamptz not null,
  duration       int not null default 30,
  name           text not null,
  phone          text not null,
  reason         text not null default '',
  status         text not null default 'new' check (status in ('new','accepted','declined','cancelled')),
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists online_bookings_clinic_idx on public.online_bookings(clinic_id, starts_at);
alter table public.online_bookings enable row level security;
drop policy if exists "bookings: team reads"   on public.online_bookings;
drop policy if exists "bookings: team handles" on public.online_bookings;
drop policy if exists "bookings: team removes" on public.online_bookings;
create policy "bookings: team reads"   on public.online_bookings for select using (public.is_member(clinic_id));
create policy "bookings: team handles" on public.online_bookings for update using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
create policy "bookings: team removes" on public.online_bookings for delete using (public.is_member(clinic_id));

-- What the public booking page may see: clinic name, logo, opening hours and which times are taken (no patient details).
create or replace function public.public_booking_info(p_code text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; logo text; busy jsonb;
begin
  select id, name, address, phone, booking into c from public.clinics where booking_code = p_code;
  if not found or not coalesce((c.booking->>'enabled')::boolean, false) then return jsonb_build_object('ok', false); end if;
  if p_to is null or p_to < p_from then p_to := p_from; end if;
  if p_to - p_from > 62 then p_to := p_from + 62; end if;
  if to_regclass('public.finance') is not null then
    execute 'select data->>''logo'' from public.finance where clinic_id = $1 and kind = ''branding'' limit 1' into logo using c.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(s, d)), '[]'::jsonb) into busy from (
    select a.starts_at s, a.duration d from public.appointments a
     where a.clinic_id = c.id and a.status <> 'cancelled' and a.starts_at >= p_from::timestamptz - interval '1 day' and a.starts_at < p_to::timestamptz + interval '2 days'
    union all
    select o.starts_at, o.duration from public.online_bookings o
     where o.clinic_id = c.id and o.status in ('new','accepted') and o.appointment_id is null and o.starts_at >= p_from::timestamptz - interval '1 day' and o.starts_at < p_to::timestamptz + interval '2 days'
  ) x;
  return jsonb_build_object('ok', true, 'name', c.name, 'address', c.address, 'phone', c.phone,
    'booking', c.booking - 'note_private', 'logo', logo, 'busy', busy);
end $$;

-- Book a time. Every rule is checked here on the server, so the page cannot be tricked.
create or replace function public.public_book(p_code text, p_start timestamptz, p_name text, p_phone text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c record; b jsonb; slot int; chairs int; loc timestamp; h jsonb; t time; ph text; nm text; taken int;
begin
  select id, booking into c from public.clinics where booking_code = p_code;
  if not found or not coalesce((c.booking->>'enabled')::boolean, false) then raise exception 'Online booking is not available for this clinic.'; end if;
  b := c.booking; slot := greatest(10, least(120, coalesce((b->>'slot')::int, 30))); chairs := greatest(1, least(10, coalesce((b->>'chairs')::int, 1)));
  nm := btrim(coalesce(p_name, '')); ph := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if length(nm) < 2 or length(nm) > 80 then raise exception 'Please write your full name.'; end if;
  if length(ph) < 10 or length(ph) > 15 then raise exception 'Please write a valid mobile number.'; end if;
  if p_start < now() + interval '30 minutes' then raise exception 'Please choose a later time.'; end if;
  if p_start > now() + make_interval(days => greatest(1, least(90, coalesce((b->>'days')::int, 30)))) then raise exception 'That date is too far ahead.'; end if;
  loc := (p_start at time zone 'UTC') + make_interval(mins => coalesce((b->>'tz')::int, 300));
  h := b->'hours'->(extract(dow from loc)::int::text);
  if h is null or jsonb_typeof(h) <> 'array' or jsonb_array_length(h) < 2 then raise exception 'The clinic is closed on that day.'; end if;
  t := loc::time;
  if t < (h->>0)::time or t + make_interval(mins => slot) > (h->>1)::time then raise exception 'That time is outside opening hours.'; end if;
  if (extract(epoch from (t - (h->>0)::time)) / 60)::int % slot <> 0 then raise exception 'Please choose one of the times shown.'; end if;
  if b->'off' ? to_char(loc, 'YYYY-MM-DD') then raise exception 'The clinic is closed on that day.'; end if;
  perform pg_advisory_xact_lock(hashtext(c.id::text));
  select count(*) into taken from (
    select 1 from public.appointments a where a.clinic_id = c.id and a.status <> 'cancelled'
      and a.starts_at < p_start + make_interval(mins => slot) and a.starts_at + make_interval(mins => a.duration) > p_start
    union all
    select 1 from public.online_bookings o where o.clinic_id = c.id and o.status in ('new','accepted') and o.appointment_id is null
      and o.starts_at < p_start + make_interval(mins => slot) and o.starts_at + make_interval(mins => o.duration) > p_start) x;
  if taken >= chairs then raise exception 'Sorry, this time was just taken. Please choose another time.'; end if;
  if (select count(*) from public.online_bookings where clinic_id = c.id and phone = ph and status = 'new') >= 3 then
    raise exception 'You already have bookings waiting. The clinic will contact you.'; end if;
  if (select count(*) from public.online_bookings where clinic_id = c.id and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many bookings right now. Please call the clinic.'; end if;
  insert into public.online_bookings (clinic_id, starts_at, duration, name, phone, reason)
  values (c.id, p_start, slot, nm, ph, left(btrim(coalesce(p_reason, '')), 200));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.public_booking_info(text, date, date) from public;
revoke all on function public.public_book(text, timestamptz, text, text, text) from public;
grant execute on function public.public_booking_info(text, date, date) to anon, authenticated;
grant execute on function public.public_book(text, timestamptz, text, text, text) to anon, authenticated;

grant update (name, address, phone, reminder_template, reg_body, reg_no, ntn, booking, booking_code) on public.clinics to authenticated;
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.online_bookings'; exception when duplicate_object then null; end;
end $$;

-- Done. You should see "Success. No rows returned".
