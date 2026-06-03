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

alter table public.contacts enable row level security;

drop policy if exists "Admins can manage contacts" on public.contacts;
create policy "Admins can manage contacts" on public.contacts
for all using (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'))
with check (exists (select 1 from public.admin_users where admin_users.email = auth.jwt() ->> 'email'));

grant select, insert, update on public.contacts to authenticated;

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
