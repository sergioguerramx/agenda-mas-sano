-- Confirmaciones operativas de WhatsApp. Conserva los horarios originales
-- y evita repetir avisos cuando Meta o el programador reintentan una ejecucion.

alter table public.appointments
  add column if not exists confirmation_first_sent_at timestamptz,
  add column if not exists confirmation_second_sent_at timestamptz,
  add column if not exists confirmation_response text,
  add column if not exists confirmation_response_at timestamptz,
  add column if not exists confirmation_released_at timestamptz,
  add column if not exists confirmation_release_notice_sent_at timestamptz,
  add column if not exists confirmation_original_time time,
  add column if not exists confirmation_last_error text;

alter table public.appointments
  drop constraint if exists appointments_confirmation_response_check;

alter table public.appointments
  add constraint appointments_confirmation_response_check
  check (confirmation_response is null or confirmation_response in ('confirmed', 'reprogram_requested'));

create index if not exists appointments_confirmation_queue_idx
on public.appointments (appointment_date, status, branch_code)
where status = 'pending';

create index if not exists appointments_release_notice_idx
on public.appointments (appointment_date)
where confirmation_released_at is not null
  and confirmation_release_notice_sent_at is null;

select pg_notify('pgrst', 'reload schema');
