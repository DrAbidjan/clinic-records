-- Clinic Patient Records – update for Expenses, Salaries and Clinic logo (October 2026)
-- Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
-- It only ADDS a new table. Your existing clinics and patients are not touched.

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

-- Done. You should see "Success. No rows returned".
