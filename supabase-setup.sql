-- =====================================================================
--  Clinic Patient Records – database setup for Supabase
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Run it ONCE on a new project.
-- =====================================================================

-- 1. Tables -------------------------------------------------------------

create table if not exists public.clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text not null default '',
  phone       text not null default '',
  invite_code text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  role       text not null default 'dentist' check (role in ('admin','dentist')),
  joined_at  timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table if not exists public.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
create index if not exists patients_clinic_idx on public.patients(clinic_id);
create index if not exists members_user_idx on public.members(user_id);

-- 2. Helper checks (used by the security rules) ------------------------

create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where clinic_id = cid and user_id = auth.uid());
$$;

create or replace function public.is_admin(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where clinic_id = cid and user_id = auth.uid() and role = 'admin');
$$;

-- 3. Security rules: every clinic sees ONLY its own data ----------------

alter table public.clinics  enable row level security;
alter table public.members  enable row level security;
alter table public.patients enable row level security;

drop policy if exists "clinic: members read"   on public.clinics;
drop policy if exists "clinic: admins update"  on public.clinics;
create policy "clinic: members read"  on public.clinics for select using (public.is_member(id));
create policy "clinic: admins update" on public.clinics for update using (public.is_admin(id)) with check (public.is_admin(id));
-- Clinics are created only through create_clinic() below.

drop policy if exists "members: team reads"            on public.members;
drop policy if exists "members: admin removes or leave" on public.members;
create policy "members: team reads" on public.members for select using (public.is_member(clinic_id));
create policy "members: admin removes or leave" on public.members for delete
  using (public.is_admin(clinic_id) or user_id = auth.uid());
-- Joining, renaming and role changes happen only through the functions below,
-- so nobody can make themselves admin.

drop policy if exists "patients: team reads"   on public.patients;
drop policy if exists "patients: team adds"    on public.patients;
drop policy if exists "patients: team edits"   on public.patients;
drop policy if exists "patients: team deletes" on public.patients;
create policy "patients: team reads"   on public.patients for select using (public.is_member(clinic_id));
create policy "patients: team adds"    on public.patients for insert with check (public.is_member(clinic_id));
create policy "patients: team edits"   on public.patients for update using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
create policy "patients: team deletes" on public.patients for delete using (public.is_member(clinic_id));

-- Stamp who changed a patient and when (cannot be faked from the app)
create or replace function public.stamp_patient()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists patients_stamp on public.patients;
create trigger patients_stamp before insert or update on public.patients
  for each row execute function public.stamp_patient();

-- 4. Clinic functions used by the app ----------------------------------

create or replace function public.new_code()
returns text language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create or replace function public.create_clinic(p_name text, p_address text, p_phone text, p_my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; code text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Clinic name is required'; end if;
  loop
    code := public.new_code();
    exit when not exists (select 1 from public.clinics where invite_code = code);
  end loop;
  insert into public.clinics (name, address, phone, invite_code, created_by)
  values (trim(p_name), coalesce(trim(p_address), ''), coalesce(trim(p_phone), ''), code, auth.uid())
  returning id into cid;
  insert into public.members (clinic_id, user_id, name, role)
  values (cid, auth.uid(), coalesce(nullif(trim(p_my_name), ''), 'Dentist'), 'admin');
  return cid;
end $$;

create or replace function public.join_clinic(p_code text, p_my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select id into cid from public.clinics where invite_code = upper(trim(p_code));
  if cid is null then raise exception 'Invite code not found. Check it with your clinic admin.'; end if;
  insert into public.members (clinic_id, user_id, name, role)
  values (cid, auth.uid(), coalesce(nullif(trim(p_my_name), ''), 'Dentist'), 'dentist')
  on conflict (clinic_id, user_id) do nothing;
  return cid;
end $$;

create or replace function public.new_invite_code(p_clinic uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_admin(p_clinic) then raise exception 'Only a clinic admin can do this'; end if;
  loop
    code := public.new_code();
    exit when not exists (select 1 from public.clinics where invite_code = code);
  end loop;
  update public.clinics set invite_code = code where id = p_clinic;
  return code;
end $$;

create or replace function public.set_member_role(p_clinic uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_clinic) then raise exception 'Only a clinic admin can do this'; end if;
  if p_role not in ('admin', 'dentist') then raise exception 'Unknown role'; end if;
  if p_role = 'dentist' and (select count(*) from public.members where clinic_id = p_clinic and role = 'admin') <= 1
     and exists (select 1 from public.members where clinic_id = p_clinic and user_id = p_user and role = 'admin') then
    raise exception 'A clinic needs at least one admin';
  end if;
  update public.members set role = p_role where clinic_id = p_clinic and user_id = p_user;
end $$;

create or replace function public.rename_me(p_clinic uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Name is required'; end if;
  update public.members set name = trim(p_name) where clinic_id = p_clinic and user_id = auth.uid();
end $$;

revoke all on function public.create_clinic(text, text, text, text) from public, anon;
revoke all on function public.join_clinic(text, text)               from public, anon;
revoke all on function public.new_invite_code(uuid)                  from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text)      from public, anon;
revoke all on function public.rename_me(uuid, text)                  from public, anon;
grant execute on function public.create_clinic(text, text, text, text) to authenticated;
grant execute on function public.join_clinic(text, text)               to authenticated;
grant execute on function public.new_invite_code(uuid)                  to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text)      to authenticated;
grant execute on function public.rename_me(uuid, text)                  to authenticated;

-- 5. Live sync between phone and computer --------------------------------
do $$ begin
  alter publication supabase_realtime add table public.patients;
exception when duplicate_object then null; end $$;

-- Done. You should see "Success. No rows returned".

-- =====================================================================
--  6. Appointments and reminder message (safe to run again)
-- =====================================================================
alter table public.clinics add column if not exists reminder_template text not null default '';

create table if not exists public.appointments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  starts_at   timestamptz not null,
  duration    int not null default 30,
  reason      text not null default '',
  note        text not null default '',
  dentist_id  uuid references auth.users(id) on delete set null,
  status      text not null default 'scheduled' check (status in ('scheduled','done','noshow','cancelled')),
  reminded_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists appointments_day_idx on public.appointments(clinic_id, starts_at);
create index if not exists appointments_patient_idx on public.appointments(patient_id);

alter table public.appointments enable row level security;
drop policy if exists "appointments: team reads"   on public.appointments;
drop policy if exists "appointments: team adds"    on public.appointments;
drop policy if exists "appointments: team edits"   on public.appointments;
drop policy if exists "appointments: team deletes" on public.appointments;
create policy "appointments: team reads"   on public.appointments for select using (public.is_member(clinic_id));
create policy "appointments: team adds"    on public.appointments for insert with check (public.is_member(clinic_id));
create policy "appointments: team edits"   on public.appointments for update using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
create policy "appointments: team deletes" on public.appointments for delete using (public.is_member(clinic_id));

do $$ begin
  alter publication supabase_realtime add table public.appointments;
exception when duplicate_object then null; end $$;

-- =====================================================================
--  7. X-rays: private image storage per clinic (safe to run again)
-- =====================================================================
create table if not exists public.xrays (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  path        text not null,
  kind        text not null default 'Periapical (PA)',
  teeth       text not null default '',
  taken_on    date not null default current_date,
  note        text not null default '',
  mime        text not null default 'image/jpeg',
  size_bytes  bigint not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists xrays_patient_idx on public.xrays(patient_id);

alter table public.xrays enable row level security;
drop policy if exists "xrays: team reads"   on public.xrays;
drop policy if exists "xrays: team adds"    on public.xrays;
drop policy if exists "xrays: team edits"   on public.xrays;
drop policy if exists "xrays: team deletes" on public.xrays;
create policy "xrays: team reads"   on public.xrays for select using (public.is_member(clinic_id));
create policy "xrays: team adds"    on public.xrays for insert with check (public.is_member(clinic_id) and split_part(path, '/', 1) = clinic_id::text);
create policy "xrays: team edits"   on public.xrays for update using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
create policy "xrays: team deletes" on public.xrays for delete using (public.is_member(clinic_id));

-- Private storage bucket. Files are saved as <clinic id>/<patient id>/<file>,
-- and only members of that clinic can upload, open or delete them.
insert into storage.buckets (id, name, public, file_size_limit)
values ('xrays', 'xrays', false, 20971520)
on conflict (id) do nothing;

create or replace function public.member_of_path(p text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  begin cid := split_part(p, '/', 1)::uuid; exception when others then return false; end;
  return public.is_member(cid);
end $$;

drop policy if exists "xrays files: team reads"   on storage.objects;
drop policy if exists "xrays files: team uploads" on storage.objects;
drop policy if exists "xrays files: team deletes" on storage.objects;
create policy "xrays files: team reads"   on storage.objects for select to authenticated using (bucket_id = 'xrays' and public.member_of_path(name));
create policy "xrays files: team uploads" on storage.objects for insert to authenticated with check (bucket_id = 'xrays' and public.member_of_path(name));
create policy "xrays files: team deletes" on storage.objects for delete to authenticated using (bucket_id = 'xrays' and public.member_of_path(name));
