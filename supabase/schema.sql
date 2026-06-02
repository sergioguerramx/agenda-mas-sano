create extension if not exists "pgcrypto";

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  whatsapp text not null,
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  google_calendar_event_id text,
  google_contact_id text,
  resend_email_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists appointments_slot_capacity_guard
on public.appointments (appointment_date, appointment_time, whatsapp)
where status in ('pending', 'confirmed');

create index if not exists appointments_date_status_idx on public.appointments (appointment_date, status);

create or replace function public.enforce_slot_capacity()
returns trigger language plpgsql as $$
declare active_count integer;
begin
  if new.status not in ('pending', 'confirmed') then return new; end if;
  select count(*) into active_count from public.appointments
  where appointment_date = new.appointment_date
    and appointment_time = new.appointment_time
    and status in ('pending', 'confirmed')
    and id <> coalesce(new.id, gen_random_uuid());
  if active_count >= 2 then raise exception 'Este horario ya tiene el maximo de citas permitido'; end if;
  return new;
end;
$$;

drop trigger if exists appointments_slot_capacity on public.appointments;
create trigger appointments_slot_capacity before insert or update on public.appointments
for each row execute function public.enforce_slot_capacity();

insert into public.admin_users (email) values
  ('info.mas.sano@gmail.com'),
  ('ms.suc.puentes@gmail.com')
on conflict (email) do nothing;

alter table public.admin_users enable row level security;
alter table public.appointments enable row level security;

create policy "Admins can read admin users" on public.admin_users
for select using (email = auth.jwt() ->> 'email');

create policy "Admins can manage appointments" on public.appointments
for all using (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'))
with check (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'));
