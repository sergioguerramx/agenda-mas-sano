-- Orígenes históricos de la antigua agenda ms.suc.mty@gmail.com.
-- Permanecen inactivos para agenda operativa, pero disponibles para
-- historial, segmentación y reactivación.

insert into public.branches (code, name, calendar_email, is_active)
values
  ('MTY_LINCOLN', 'Monterrey Lincoln / Poniente', null, false),
  ('MTY_MITRAS', 'Monterrey Mitras Centro', null, false)
on conflict (code) do update set
  name = excluded.name,
  is_active = false,
  updated_at = now();

comment on table public.branches is
  'Sucursales activas y sedes históricas utilizadas para conservar el origen de cada cita.';
