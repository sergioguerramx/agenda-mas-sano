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
  google_contact_resource_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contacts
add column if not exists google_contact_resource_name text;

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
  latest_appointment_record public.appointments%rowtype;
  appointment_total integer;
  first_appointment_date date;
  last_appointment_date date;
begin
  select * into appointment_record
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception using message = 'No se encontro la cita para actualizar contacto.';
  end if;

  select
    count(*),
    min(appointment_date),
    max(appointment_date)
  into
    appointment_total,
    first_appointment_date,
    last_appointment_date
  from public.appointments
  where whatsapp = appointment_record.whatsapp;

  select * into latest_appointment_record
  from public.appointments
  where whatsapp = appointment_record.whatsapp
  order by appointment_date desc, appointment_time desc, created_at desc
  limit 1;

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
    coalesce(first_appointment_date, appointment_record.appointment_date),
    coalesce(last_appointment_date, appointment_record.appointment_date),
    greatest(appointment_total, 1),
    latest_appointment_record.status,
    latest_appointment_record.id,
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

drop function if exists public.request_public_appointment(text, text, text, date, time);

create or replace function public.request_public_appointment(
  p_first_name text,
  p_last_name text,
  p_whatsapp text,
  p_appointment_date date,
  p_appointment_time time
)
returns table (
  success boolean,
  appointment_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  new_appointment_id uuid;
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
  )
  returning id into new_appointment_id;

  perform public.sync_contact_from_appointment(new_appointment_id);

  return query select true, new_appointment_id;
end;
$$;

grant execute on function public.request_public_appointment(text, text, text, date, time) to anon, authenticated;
