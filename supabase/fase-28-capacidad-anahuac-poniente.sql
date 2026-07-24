-- Desde el 3 de agosto, Anáhuac y Monterrey Poniente tienen
-- una cita por horario y dos lugares en los horarios terminados en :20.

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
    when p_appointment_date >= date '2026-08-03'
      and to_char(p_appointment_time, 'MI') = '20'
      then 2
    when p_appointment_date >= date '2026-08-03'
      then 1
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

grant execute on function public.slot_capacity_for_branch(date, time, text)
to anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
