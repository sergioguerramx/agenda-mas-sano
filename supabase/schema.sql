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

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  whatsapp text not null unique,
  source text not null default 'Agenda Mas Sano',
  branch text not null default 'San Nicolás',
  first_appointment_date date not null,
  last_appointment_date date not null,
  total_appointments integer not null default 1,
  latest_status text not null default 'pending' check (latest_status in ('pending', 'confirmed', 'cancelled', 'completed')),
  latest_appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_name_idx on public.contacts (last_name, first_name);
create index if not exists contacts_last_appointment_idx on public.contacts (last_appointment_date desc);

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
alter table public.contacts enable row level security;

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users" on public.admin_users
for select using (email = auth.jwt() ->> 'email');

drop policy if exists "Admins can manage appointments" on public.appointments;
create policy "Admins can manage appointments" on public.appointments
for all using (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'))
with check (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'));

drop policy if exists "Admins can manage contacts" on public.contacts;
create policy "Admins can manage contacts" on public.contacts
for all using (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'))
with check (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'));

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.contacts to authenticated;

create or replace function public.public_slot_counts(start_date date, end_date date)
returns table (
  appointment_date date,
  appointment_time time,
  active_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    appointments.appointment_date,
    appointments.appointment_time,
    count(*) as active_count
  from public.appointments
  where appointments.appointment_date between start_date and end_date
    and appointments.status in ('pending', 'confirmed')
  group by appointments.appointment_date, appointments.appointment_time;
$$;

grant execute on function public.public_slot_counts(date, date) to anon, authenticated;

create or replace function public.sync_contact_from_appointment(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_record public.appointments%rowtype;
  appointment_total integer;
begin
  select * into appointment_record
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception using message = 'No se encontro la cita para actualizar contacto.';
  end if;

  select count(*) into appointment_total
  from public.appointments
  where whatsapp = appointment_record.whatsapp;

  insert into public.contacts (
    first_name,
    last_name,
    whatsapp,
    source,
    branch,
    first_appointment_date,
    last_appointment_date,
    total_appointments,
    latest_status,
    latest_appointment_id,
    updated_at
  )
  values (
    appointment_record.first_name,
    appointment_record.last_name,
    appointment_record.whatsapp,
    'Agenda Mas Sano',
    'San Nicolás',
    appointment_record.appointment_date,
    appointment_record.appointment_date,
    greatest(appointment_total, 1),
    appointment_record.status,
    appointment_record.id,
    now()
  )
  on conflict (whatsapp) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    source = excluded.source,
    branch = excluded.branch,
    first_appointment_date = least(public.contacts.first_appointment_date, excluded.first_appointment_date),
    last_appointment_date = greatest(public.contacts.last_appointment_date, excluded.last_appointment_date),
    total_appointments = excluded.total_appointments,
    latest_status = excluded.latest_status,
    latest_appointment_id = excluded.latest_appointment_id,
    updated_at = now();
end;
$$;

grant execute on function public.sync_contact_from_appointment(uuid) to authenticated;

drop policy if exists "Public can request pending appointments" on public.appointments;
revoke insert on public.appointments from anon, authenticated;

create or replace function public.request_public_appointment(
  p_first_name text,
  p_last_name text,
  p_whatsapp text,
  p_appointment_date date,
  p_appointment_time time
)
returns table (
  success boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
begin
  if nullif(trim(p_first_name), '') is null then
    raise exception using message = 'Agrega nombre para continuar.';
  end if;

  if nullif(trim(p_last_name), '') is null then
    raise exception using message = 'Agrega apellidos para continuar.';
  end if;

  if nullif(trim(p_whatsapp), '') is null then
    raise exception using message = 'Agrega WhatsApp para continuar.';
  end if;

  select count(*) into active_count
  from public.appointments
  where appointment_date = p_appointment_date
    and appointment_time = p_appointment_time
    and status in ('pending', 'confirmed');

  if active_count >= 2 then
    raise exception using message = 'Este horario ya no tiene lugares disponibles.';
  end if;

  insert into public.appointments (
    first_name,
    last_name,
    whatsapp,
    appointment_date,
    appointment_time,
    status
  )
  values (
    trim(p_first_name),
    trim(p_last_name),
    trim(p_whatsapp),
    p_appointment_date,
    p_appointment_time,
    'pending'
  );

  return query select true;
end;
$$;

grant execute on function public.request_public_appointment(text, text, text, date, time) to anon, authenticated;
