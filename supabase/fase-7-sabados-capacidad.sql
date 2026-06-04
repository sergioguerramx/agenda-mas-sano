create or replace function public.slot_capacity_for_appointment(
  p_appointment_date date,
  p_appointment_time time
)
returns integer
language sql
immutable
as $$
  select case
    when extract(dow from p_appointment_date) = 6
      and to_char(p_appointment_time, 'MI') = '20'
      then 3
    else 2
  end;
$$;

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
  where appointment_date = new.appointment_date
    and appointment_time = new.appointment_time
    and status in ('pending', 'confirmed')
    and id <> coalesce(new.id, gen_random_uuid())
    and created_at >= now() - interval '5 minutes';

  if active_count >= slot_capacity then
    raise exception 'Este horario ya tiene el maximo de citas permitido';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_slot_capacity on public.appointments;
create trigger appointments_slot_capacity
before insert or update on public.appointments
for each row execute function public.enforce_slot_capacity();

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
  slot_capacity integer;
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

grant execute on function public.slot_capacity_for_appointment(date, time) to anon, authenticated, service_role;
grant execute on function public.request_public_appointment(text, text, text, date, time) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
