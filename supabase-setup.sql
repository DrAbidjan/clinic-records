-- =====================================================================
--  Clinic Patient Records – ONLINE version – database setup for Supabase
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again. After it, also run the short "activation secret"
--  snippet from your Key Maker page (once).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 1. Tables -------------------------------------------------------------

create table if not exists public.clinics (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  address           text not null default '',
  phone             text not null default '',
  invite_code       text not null unique,
  reminder_template text not null default '',
  license_key       text,
  license_name      text,
  licensed_at       timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create table if not exists public.members (
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  role       text not null default 'dentist',
  joined_at  timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('admin','dentist','accountant'));

create table if not exists public.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create table if not exists public.appointments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  starts_at   timestamptz not null,
  duration    int not null default 30,
  reason      text not null default '',
  note        text not null default '',
  dentist_id  uuid references auth.users(id) on delete set null,
  status      text not null default 'scheduled',
  reminded_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check check (status in ('scheduled','arrived','done','noshow','cancelled'));

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

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  sender      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_name text not null default '',
  recipient   text not null default 'all',
  body        text not null,
  kind        text not null default 'msg',
  patient_id  uuid references public.patients(id) on delete set null,
  read_by     uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  role        text not null default '',
  started_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  ended_at    timestamptz,
  auto        boolean not null default false
);

-- Registration numbers printed on records, invoices and receipts
alter table public.clinics add column if not exists reg_body text not null default '';
alter table public.clinics add column if not exists reg_no   text not null default '';
alter table public.clinics add column if not exists ntn      text not null default '';
alter table public.members add column if not exists pmdc     text not null default '';

create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  paid_on          date not null default current_date,
  amount           numeric(12,2) not null default 0 check (amount >= 0),
  discount         numeric(12,2) not null default 0 check (discount >= 0),
  disc_pct         numeric(5,2),
  disc_reason      text not null default '',
  method           text not null default 'Cash',
  reference        text not null default '',
  note             text not null default '',
  received_by      uuid default auth.uid() references auth.users(id) on delete set null,
  received_by_name text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists payments_patient_idx on public.payments(patient_id, paid_on);

create index if not exists patients_clinic_idx     on public.patients(clinic_id);
create index if not exists members_user_idx        on public.members(user_id);
create index if not exists appointments_day_idx    on public.appointments(clinic_id, starts_at);
create index if not exists appointments_pat_idx    on public.appointments(patient_id);
create index if not exists xrays_patient_idx       on public.xrays(patient_id);
create index if not exists messages_clinic_idx     on public.messages(clinic_id, created_at);
create index if not exists attendance_clinic_idx   on public.attendance(clinic_id, started_at);

-- 2. Helper checks -----------------------------------------------------

create table if not exists private.settings (key text primary key, value text not null);

create or replace function private.clinic_code(cid uuid) returns text
language sql immutable as $$ select upper(substr(replace(cid::text,'-',''),1,10)) $$;

create or replace function private.b64url(s text) returns bytea
language sql immutable as $$ select decode(rpad(translate(s,'-_','+/'), ((length(s)+3)/4)*4, '='), 'base64') $$;

-- Checks a key made in the Key Maker (format CPO1-<data>.<signature>). Returns its contents, or null.
create or replace function private.check_key(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k text; parts text[]; payload bytea; sig bytea; secret bytea;
begin
  select decode(value,'hex') into secret from private.settings where key = 'license_secret';
  if secret is null then raise exception 'Activation is not set up on the server yet. Run the activation secret snippet from the Key Maker.'; end if;
  k := regexp_replace(coalesce(p_key,''), '\s', '', 'g');
  if k !~ '^CPO1-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then return null; end if;
  parts := string_to_array(substr(k, 6), '.');
  begin
    payload := private.b64url(parts[1]); sig := private.b64url(parts[2]);
  exception when others then return null; end;
  if extensions.hmac(payload, secret, 'sha256') <> sig then return null; end if;
  return convert_from(payload, 'UTF8')::jsonb;
end $$;

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where clinic_id = cid and user_id = auth.uid());
$$;
create or replace function public.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where clinic_id = cid and user_id = auth.uid() and role = 'admin');
$$;
create or replace function public.has_role(cid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where clinic_id = cid and user_id = auth.uid() and role = any(roles));
$$;
-- 14-day free trial from the day the clinic was created, then read-only until activated.
create or replace function public.is_active(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinics where id = cid and (licensed_at is not null or created_at > now() - interval '14 days'));
$$;
-- Dentists and admins may change clinical records while the clinic is active; accountants only view.
create or replace function public.can_edit(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(cid, array['admin','dentist']) and public.is_active(cid);
$$;
create or replace function public.path_clinic(p text) returns uuid
language plpgsql immutable as $$ begin return split_part(p, '/', 1)::uuid; exception when others then return null; end $$;

-- 3. Security rules: every clinic sees ONLY its own data ----------------

alter table public.clinics      enable row level security;
alter table public.members      enable row level security;
alter table public.patients     enable row level security;
alter table public.appointments enable row level security;
alter table public.xrays        enable row level security;
alter table public.messages     enable row level security;
alter table public.attendance   enable row level security;
alter table public.payments     enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('clinics','members','patients','appointments','xrays','messages','attendance','payments') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "clinic: members read"  on public.clinics for select using (public.is_member(id));
create policy "clinic: admins update" on public.clinics for update using (public.is_admin(id)) with check (public.is_admin(id));
-- Admins may edit only these columns; licence fields are set only by the activate() function:
revoke update on public.clinics from authenticated, anon;
grant update (name, address, phone, reminder_template, reg_body, reg_no, ntn) on public.clinics to authenticated;

create policy "members: team reads" on public.members for select using (public.is_member(clinic_id));
create policy "members: admin removes or leave" on public.members for delete using (public.is_admin(clinic_id) or user_id = auth.uid());

create policy "patients: team reads"   on public.patients for select using (public.is_member(clinic_id));
create policy "patients: edit adds"    on public.patients for insert with check (public.can_edit(clinic_id));
create policy "patients: edit changes" on public.patients for update using (public.can_edit(clinic_id)) with check (public.can_edit(clinic_id));
create policy "patients: edit deletes" on public.patients for delete using (public.can_edit(clinic_id));

create policy "appointments: team reads"   on public.appointments for select using (public.is_member(clinic_id));
create policy "appointments: team adds"    on public.appointments for insert with check (public.is_member(clinic_id) and public.is_active(clinic_id));
create policy "appointments: team edits"   on public.appointments for update using (public.is_member(clinic_id) and public.is_active(clinic_id)) with check (public.is_member(clinic_id));
create policy "appointments: team deletes" on public.appointments for delete using (public.is_member(clinic_id) and public.is_active(clinic_id));

create policy "xrays: team reads"   on public.xrays for select using (public.is_member(clinic_id));
create policy "xrays: edit adds"    on public.xrays for insert with check (public.can_edit(clinic_id) and split_part(path, '/', 1) = clinic_id::text);
create policy "xrays: edit changes" on public.xrays for update using (public.can_edit(clinic_id)) with check (public.can_edit(clinic_id));
create policy "xrays: edit deletes" on public.xrays for delete using (public.can_edit(clinic_id));

create policy "messages: read mine"  on public.messages for select using (public.is_member(clinic_id) and (recipient = 'all' or recipient = auth.uid()::text or sender = auth.uid()));
create policy "messages: send"       on public.messages for insert with check (public.is_member(clinic_id) and sender = auth.uid());
create policy "messages: mark read"  on public.messages for update using (public.is_member(clinic_id) and (recipient = 'all' or recipient = auth.uid()::text)) with check (public.is_member(clinic_id));

create policy "payments: team reads"     on public.payments for select using (public.is_member(clinic_id));
create policy "payments: team records"   on public.payments for insert with check (public.is_member(clinic_id) and public.is_active(clinic_id) and received_by = auth.uid());
create policy "payments: managers delete" on public.payments for delete using (public.has_role(clinic_id, array['admin','accountant']) and public.is_active(clinic_id));

create policy "attendance: own or manager reads" on public.attendance for select using (user_id = auth.uid() or public.has_role(clinic_id, array['admin','accountant']));
create policy "attendance: own start"           on public.attendance for insert with check (user_id = auth.uid() and public.is_member(clinic_id));
create policy "attendance: own update"          on public.attendance for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Who changed a patient, and when (cannot be faked from the app)
create or replace function public.stamp_patient() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists patients_stamp on public.patients;
create trigger patients_stamp before insert or update on public.patients for each row execute function public.stamp_patient();

-- 4. Clinic functions used by the app ----------------------------------

create or replace function public.new_code() returns text language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create or replace function public.create_clinic(p_name text, p_address text, p_phone text, p_my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; code text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Clinic name is required'; end if;
  loop code := public.new_code(); exit when not exists (select 1 from public.clinics where invite_code = code); end loop;
  insert into public.clinics (name, address, phone, invite_code, created_by)
  values (trim(p_name), coalesce(trim(p_address), ''), coalesce(trim(p_phone), ''), code, auth.uid()) returning id into cid;
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
  loop code := public.new_code(); exit when not exists (select 1 from public.clinics where invite_code = code); end loop;
  update public.clinics set invite_code = code where id = p_clinic;
  return code;
end $$;

create or replace function public.set_member_role(p_clinic uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_clinic) then raise exception 'Only a clinic admin can do this'; end if;
  if p_role not in ('admin','dentist','accountant') then raise exception 'Unknown role'; end if;
  if p_role <> 'admin' and (select count(*) from public.members where clinic_id = p_clinic and role = 'admin') <= 1
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

create or replace function public.set_my_pmdc(p_clinic uuid, p_pmdc text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.members set pmdc = coalesce(trim(p_pmdc), '') where clinic_id = p_clinic and user_id = auth.uid();
end $$;

create or replace function public.activate(p_clinic uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p jsonb; code text := private.clinic_code(p_clinic);
begin
  if not public.is_admin(p_clinic) then raise exception 'Only a clinic admin can do this'; end if;
  p := private.check_key(p_key);
  if p is null or coalesce(p->>'t','') = 'del' then raise exception 'This activation key is not valid. Copy the whole key exactly as you received it.'; end if;
  if p->>'c' <> code then raise exception 'This key was made for a different clinic code. Your clinic code is %-%.', substr(code,1,5), substr(code,6); end if;
  update public.clinics set license_key = regexp_replace(p_key,'\s','','g'), license_name = p->>'n', licensed_at = now() where id = p_clinic;
  return jsonb_build_object('name', p->>'n', 'date', p->>'d');
end $$;

create or replace function public.check_delete_code(p_clinic uuid, p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p jsonb; code text := private.clinic_code(p_clinic);
begin
  if not public.is_admin(p_clinic) then raise exception 'Only a clinic admin can do this'; end if;
  p := private.check_key(p_key);
  if p is null or coalesce(p->>'t','') <> 'del' then raise exception 'This deletion code is not valid. Copy the whole code exactly as you received it.'; end if;
  if p->>'c' <> code then raise exception 'This deletion code was made for a different clinic code. Your clinic code is %-%.', substr(code,1,5), substr(code,6); end if;
  if abs(current_date - (p->>'d')::date) > 1 then raise exception 'This deletion code has expired. Ask for a new one.'; end if;
  return true;
end $$;

create or replace function public.delete_clinic(p_clinic uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare p jsonb; code text := private.clinic_code(p_clinic);
begin
  if not public.is_admin(p_clinic) then raise exception 'Only a clinic admin can do this'; end if;
  p := private.check_key(p_key);
  if p is null or coalesce(p->>'t','') <> 'del' then raise exception 'This deletion code is not valid. Copy the whole code exactly as you received it.'; end if;
  if p->>'c' <> code then raise exception 'This deletion code was made for a different clinic code. Your clinic code is %-%.', substr(code,1,5), substr(code,6); end if;
  if abs(current_date - (p->>'d')::date) > 1 then raise exception 'This deletion code has expired. Ask for a new one.'; end if;
  delete from public.clinics where id = p_clinic;
end $$;

do $$ declare f text; begin
  foreach f in array array['create_clinic(text,text,text,text)','join_clinic(text,text)','new_invite_code(uuid)',
    'set_member_role(uuid,uuid,text)','rename_me(uuid,text)','activate(uuid,text)','delete_clinic(uuid,text)','check_delete_code(uuid,text)','set_my_pmdc(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- 5. X-ray and photo files: private storage per clinic -----------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('xrays', 'xrays', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "xrays files: team reads"   on storage.objects;
drop policy if exists "xrays files: team uploads" on storage.objects;
drop policy if exists "xrays files: team deletes" on storage.objects;
create policy "xrays files: team reads"   on storage.objects for select to authenticated using (bucket_id = 'xrays' and public.is_member(public.path_clinic(name)));
create policy "xrays files: team uploads" on storage.objects for insert to authenticated with check (bucket_id = 'xrays' and public.can_edit(public.path_clinic(name)));
create policy "xrays files: team deletes" on storage.objects for delete to authenticated using (bucket_id = 'xrays' and (public.is_admin(public.path_clinic(name)) or public.can_edit(public.path_clinic(name))));

-- 6. Live updates between computers ------------------------------------
do $$ declare t text; begin
  foreach t in array array['patients','appointments','messages','payments'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Done. You should see "Success. No rows returned".
