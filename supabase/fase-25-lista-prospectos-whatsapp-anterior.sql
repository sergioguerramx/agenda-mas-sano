-- Lista comercial separada de pacientes e información clínica.
-- Conserva prospectos provenientes del WhatsApp anterior sin mezclarlos
-- con patient_profiles ni con la bandeja activa del nuevo número.

create extension if not exists "pgcrypto";

create table if not exists public.marketing_prospects (
  id uuid primary key default gen_random_uuid(),
  whatsapp text not null unique check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  contact_name text,
  source text not null default 'whatsapp_anterior',
  source_batch text,
  branch_interest text not null default 'POR_CONFIRMAR',
  heat_level text not null default 'por_revisar',
  status text not null default 'nuevo',
  last_contact_date date,
  contact_reason text,
  can_contact boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (branch_interest in ('SN', 'MTY_SUR', 'POR_CONFIRMAR')),
  check (heat_level in ('muy_caliente', 'caliente', 'tibio', 'por_revisar')),
  check (status in ('nuevo', 'contactado', 'interesado', 'cita_agendada', 'no_interesado', 'no_contactar'))
);

create index if not exists marketing_prospects_priority_idx
on public.marketing_prospects (can_contact, heat_level, last_contact_date desc);

create index if not exists marketing_prospects_branch_idx
on public.marketing_prospects (branch_interest, status, last_contact_date desc);

alter table public.marketing_prospects enable row level security;

drop policy if exists "Admins manage marketing prospects" on public.marketing_prospects;
create policy "Admins manage marketing prospects"
on public.marketing_prospects
for all
using (exists (
  select 1 from public.admin_users
  where admin_users.email = auth.jwt() ->> 'email'
))
with check (exists (
  select 1 from public.admin_users
  where admin_users.email = auth.jwt() ->> 'email'
));

grant select, insert, update on public.marketing_prospects to authenticated, service_role;
revoke all on public.marketing_prospects from anon;

select pg_notify('pgrst', 'reload schema');
