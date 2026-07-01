alter table public.appointments
  add column if not exists origin text not null default 'agenda_mas_sano';

create index if not exists appointments_origin_idx on public.appointments (origin);

select pg_notify('pgrst', 'reload schema');
