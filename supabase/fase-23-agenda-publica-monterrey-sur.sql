-- Habilita la agenda pública de Monterrey Poniente con capacidad independiente.

create or replace function public.slot_capacity_for_branch(
  p_appointment_date date,
  p_appointment_time time,
  p_branch_code text
)
returns integer
language sql
immutable
as $$
  select case
    when upper(trim(p_branch_code)) = 'MTY_SUR'
      and to_char(p_appointment_time, 'MI') = '20'
      then 2
    when upper(trim(p_branch_code)) = 'MTY_SUR'
      then 1
    when extract(dow from p_appointment_date) = 6
      and to_char(p_appointment_time, 'MI') = '20'
      then 3
    else 2
  end;
$$;

create or replace function public.slot_capacity_for_appointment(
  p_appointment_date date,
  p_appointment_time time
)
returns integer
language sql
immutable
as $$
  select public.slot_capacity_for_branch(p_appointment_date, p_appointment_time, 'SN');
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

  slot_capacity := public.slot_capacity_for_branch(new.appointment_date, new.appointment_time, new.branch_code);

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

drop trigger if exists appointments_slot_capacity on public.appointments;
create trigger appointments_slot_capacity
before insert or update on public.appointments
for each row execute function public.enforce_slot_capacity();

create or replace function public.request_public_appointment(
  p_first_name text,
  p_last_name text,
  p_whatsapp text,
  p_appointment_date date,
  p_appointment_time time,
  p_branch_code text
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
  normalized_branch text;
begin
  normalized_branch := upper(trim(p_branch_code));

  if normalized_branch not in ('SN', 'MTY_SUR') then
    raise exception using message = 'Elige una sucursal válida.';
  end if;
  if normalized_branch = 'MTY_SUR' and p_appointment_date < date '2026-08-03' then
    raise exception using message = 'Monterrey Poniente abre agenda a partir del 3 de agosto.';
  end if;
  if not exists (
    select 1 from public.branches
    where code = normalized_branch and is_active = true
  ) then
    raise exception using message = 'Esta sucursal no está disponible.';
  end if;
  if nullif(trim(p_first_name), '') is null then raise exception using message = 'Agrega nombre para continuar.'; end if;
  if nullif(trim(p_last_name), '') is null then raise exception using message = 'Agrega apellidos para continuar.'; end if;
  if nullif(trim(p_whatsapp), '') is null then raise exception using message = 'Agrega WhatsApp para continuar.'; end if;

  slot_capacity := public.slot_capacity_for_branch(p_appointment_date, p_appointment_time, normalized_branch);

  select count(*) into active_count
  from public.appointments
  where branch_code = normalized_branch
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
    p_appointment_date, p_appointment_time, 'pending', normalized_branch
  ) returning id into new_appointment_id;

  perform public.sync_contact_from_appointment(new_appointment_id);
  return query select true, new_appointment_id;
end;
$$;

grant execute on function public.slot_capacity_for_branch(date, time, text) to anon, authenticated, service_role;
grant execute on function public.request_public_appointment(text, text, text, date, time, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
