drop index if exists public.appointments_slot_capacity_guard;

create index if not exists appointments_slot_lookup_idx
on public.appointments (appointment_date, appointment_time, status);

select pg_notify('pgrst', 'reload schema');
