-- Separa las citas nuevas por sucursal y conserva San Nicolás como valor
-- predeterminado para la agenda pública actual.

alter table public.appointments
  add column if not exists branch_code text not null default 'SN';

alter table public.appointments
  drop constraint if exists appointments_branch_code_check;

alter table public.appointments
  add constraint appointments_branch_code_check
  check (branch_code in ('SN', 'MTY_SUR'));

create index if not exists appointments_branch_slot_idx
on public.appointments (branch_code, appointment_date, appointment_time, status);

create or replace function public.enforce_slot_capacity()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
  slot_capacity integer;
begin
  if new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  slot_capacity := public.slot_capacity_for_appointment(new.appointment_date, new.appointment_time);

  select count(*) into active_count
  from public.appointments
  where branch_code = new.branch_code
    and appointment_date = new.appointment_date
    and appointment_time = new.appointment_time
    and status in ('pending', 'confirmed')
    and id <> coalesce(new.id, gen_random_uuid());

  if active_count >= slot_capacity then
    raise exception 'Este horario ya tiene el maximo de citas permitido';
  end if;

  return new;
end;
$$;

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
  where appointments.branch_code = 'SN'
    and appointments.appointment_date between start_date and end_date
    and appointments.status in ('pending', 'confirmed')
  group by appointments.appointment_date, appointments.appointment_time;
$$;

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
  contact_source text;
  contact_branch text;
begin
  select * into appointment_record
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception using message = 'No se encontro la cita para actualizar contacto.';
  end if;

  contact_source := case
    when appointment_record.brand = 'yo_soy_sano' then 'Yo Soy Sano'
    else 'Agenda Mas Sano'
  end;

  contact_branch := case
    when appointment_record.modality = 'online' then 'Online'
    when appointment_record.branch_code = 'MTY_SUR' then 'Monterrey Sur'
    else 'San Nicolás'
  end;

  select count(*), min(appointment_date), max(appointment_date)
  into appointment_total, first_appointment_date, last_appointment_date
  from public.appointments
  where whatsapp = appointment_record.whatsapp;

  select * into latest_appointment_record
  from public.appointments
  where whatsapp = appointment_record.whatsapp
  order by appointment_date desc, appointment_time desc, created_at desc
  limit 1;

  insert into public.contacts (
    first_name, last_name, whatsapp, source, branch,
    first_appointment_date, last_appointment_date, total_appointments,
    latest_status, latest_appointment_id, updated_at
  ) values (
    appointment_record.first_name,
    appointment_record.last_name,
    appointment_record.whatsapp,
    contact_source,
    contact_branch,
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

create or replace function public.sync_operational_appointment_to_history(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.appointments%rowtype;
  patient_uuid uuid;
  branch_smallint smallint;
  service_smallint smallint;
  combined_name text;
  combined_name_key text;
  appointment_timestamp timestamptz;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if not found then return; end if;

  combined_name := regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g');
  combined_name_key := lower(combined_name);

  select id into branch_smallint
  from public.branches
  where code = coalesce(a.branch_code, 'SN');

  select p.id into patient_uuid
  from public.patient_profiles p
  where p.whatsapp = a.whatsapp
    and p.name_key = combined_name_key
  order by p.created_at
  limit 1;

  if patient_uuid is null then
    insert into public.patient_profiles (
      full_name, whatsapp, whatsapp_status, promotional_consent
    ) values (
      combined_name,
      case when a.whatsapp ~ '^\+[1-9][0-9]{7,14}$' then a.whatsapp else null end,
      case when a.whatsapp ~ '^\+[1-9][0-9]{7,14}$' then 1 else 0 end,
      1
    ) returning id into patient_uuid;
  end if;

  select id into service_smallint
  from public.services_catalog
  where code = coalesce(a.service, 'sesion_integral_399')
  limit 1;

  appointment_timestamp := (a.appointment_date + a.appointment_time) at time zone 'America/Monterrey';

  insert into public.patient_appointment_history (
    patient_id, branch_id, service_id, scheduled_at, confirmed, attended,
    released_at_8, cancelled, source_kind, source_event_key,
    calendar_event_id, legacy_appointment_id, confidence, updated_at
  ) values (
    patient_uuid,
    branch_smallint,
    service_smallint,
    appointment_timestamp,
    case when a.status in ('confirmed', 'completed') then true else null end,
    case when a.status = 'completed' then true else null end,
    a.appointment_time = time '08:00',
    a.status = 'cancelled',
    case when a.origin = 'yosoysano' then 4 else 1 end,
    'current:' || a.id::text,
    a.google_calendar_event_id,
    a.id,
    100,
    now()
  )
  on conflict (legacy_appointment_id) do update set
    patient_id = excluded.patient_id,
    branch_id = excluded.branch_id,
    service_id = excluded.service_id,
    scheduled_at = excluded.scheduled_at,
    confirmed = excluded.confirmed,
    attended = excluded.attended,
    released_at_8 = excluded.released_at_8,
    cancelled = excluded.cancelled,
    calendar_event_id = excluded.calendar_event_id,
    updated_at = now();
end;
$$;

drop trigger if exists mirror_operational_appointment_history on public.appointments;
create trigger mirror_operational_appointment_history
after insert or update of first_name, last_name, whatsapp, appointment_date,
  appointment_time, status, google_calendar_event_id, service, branch_code
on public.appointments
for each row execute function public.mirror_operational_appointment_to_history();

-- La página pública actual continúa agendando exclusivamente en San Nicolás.
create or replace function public.request_public_appointment(
  p_first_name text,
  p_last_name text,
  p_whatsapp text,
  p_appointment_date date,
  p_appointment_time time
)
returns table (success boolean, appointment_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  slot_capacity integer;
  new_appointment_id uuid;
begin
  if nullif(trim(p_first_name), '') is null then raise exception using message = 'Agrega nombre para continuar.'; end if;
  if nullif(trim(p_last_name), '') is null then raise exception using message = 'Agrega apellidos para continuar.'; end if;
  if nullif(trim(p_whatsapp), '') is null then raise exception using message = 'Agrega WhatsApp para continuar.'; end if;

  slot_capacity := public.slot_capacity_for_appointment(p_appointment_date, p_appointment_time);

  select count(*) into active_count
  from public.appointments
  where branch_code = 'SN'
    and appointment_date = p_appointment_date
    and appointment_time = p_appointment_time
    and status in ('pending', 'confirmed');

  if active_count >= slot_capacity then
    raise exception using message = 'Este horario ya no tiene lugares disponibles.';
  end if;

  insert into public.appointments (
    first_name, last_name, whatsapp, appointment_date, appointment_time,
    status, branch_code
  ) values (
    trim(p_first_name), trim(p_last_name), trim(p_whatsapp),
    p_appointment_date, p_appointment_time, 'pending', 'SN'
  ) returning id into new_appointment_id;

  perform public.sync_contact_from_appointment(new_appointment_id);
  return query select true, new_appointment_id;
end;
$$;

grant execute on function public.request_public_appointment(text, text, text, date, time) to anon, authenticated;
select pg_notify('pgrst', 'reload schema');
