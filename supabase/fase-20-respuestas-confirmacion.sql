-- Permite distinguir una cancelacion expresa de una solicitud para reagendar.
alter table public.appointments
  drop constraint if exists appointments_confirmation_response_check;

alter table public.appointments
  add constraint appointments_confirmation_response_check
  check (confirmation_response is null or confirmation_response in ('confirmed', 'reprogram_requested', 'cancelled'));

