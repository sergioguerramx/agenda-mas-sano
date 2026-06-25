alter table public.appointments
  add column if not exists brand text not null default 'mas_sano',
  add column if not exists modality text not null default 'presencial',
  add column if not exists service text not null default 'sesion_integral_399',
  add column if not exists origin text not null default 'agenda_mas_sano',
  add column if not exists registro_id uuid,
  add column if not exists cliente_id uuid,
  add column if not exists correo text;

create index if not exists appointments_brand_idx on public.appointments (brand);
create index if not exists appointments_origin_idx on public.appointments (origin);
create unique index if not exists appointments_yosoysano_registro_unique
on public.appointments (registro_id)
where registro_id is not null and status in ('pending', 'confirmed');

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
    else 'San Nicolás'
  end;

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

create or replace function public.request_yosoysano_appointment(
  p_first_name text,
  p_last_name text,
  p_whatsapp text,
  p_correo text,
  p_appointment_date date,
  p_appointment_time time,
  p_service text,
  p_registro_id uuid,
  p_cliente_id uuid
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
  slot_capacity integer;
  new_appointment_id uuid;
begin
  if p_service not in ('sesion_online_399', 'paquete_1199') then
    raise exception using message = 'Este producto no permite agendar llamada.';
  end if;

  if nullif(trim(p_first_name), '') is null then
    raise exception using message = 'Agrega nombre para continuar.';
  end if;

  if nullif(trim(p_last_name), '') is null then
    raise exception using message = 'Agrega apellidos para continuar.';
  end if;

  if nullif(trim(p_whatsapp), '') is null then
    raise exception using message = 'Agrega WhatsApp para continuar.';
  end if;

  slot_capacity := public.slot_capacity_for_appointment(p_appointment_date, p_appointment_time);

  select count(*) into active_count
  from public.appointments
  where appointment_date = p_appointment_date
    and appointment_time = p_appointment_time
    and status in ('pending', 'confirmed')
    and created_at >= now() - interval '5 minutes';

  if active_count >= slot_capacity then
    raise exception using message = 'Este horario ya no tiene lugares disponibles.';
  end if;

  insert into public.appointments (
    first_name,
    last_name,
    whatsapp,
    appointment_date,
    appointment_time,
    status,
    brand,
    modality,
    service,
    origin,
    registro_id,
    cliente_id,
    correo
  )
  values (
    trim(p_first_name),
    trim(p_last_name),
    trim(p_whatsapp),
    p_appointment_date,
    p_appointment_time,
    'pending',
    'yo_soy_sano',
    'online',
    p_service,
    'yosoysano',
    p_registro_id,
    p_cliente_id,
    lower(trim(coalesce(p_correo, '')))
  )
  returning id into new_appointment_id;

  perform public.sync_contact_from_appointment(new_appointment_id);

  return query select true, new_appointment_id;
end;
$$;

grant execute on function public.request_yosoysano_appointment(text, text, text, text, date, time, text, uuid, uuid) to anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
