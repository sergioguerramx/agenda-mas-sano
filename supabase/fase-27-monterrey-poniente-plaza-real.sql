-- Actualiza la identidad pública de la sucursal de Monterrey sin cambiar su
-- código interno ni su calendario, para conservar historial e integraciones.

update public.branches
set
  name = 'Más Sano Nutrición Holística - Suc. Monterrey Poniente',
  calendar_email = 'ms.suc.mty@gmail.com',
  is_active = true,
  updated_at = now()
where code = 'MTY_SUR';

update public.branch_locations
set
  label = 'Plaza Real · ALFAO Business Center',
  address = 'Plaza Real, Av. Dr. José Eleuterio González 315, SUB-4, Jardines del Cerro, Monterrey, N.L., C.P. 64050. Segundo piso, dentro de ALFAO Business Center.',
  maps_url = 'https://maps.app.goo.gl/HE2SPPVTPo27Zh2U6',
  valid_until = null,
  updated_at = now()
where branch_id = (select id from public.branches where code = 'MTY_SUR')
  and valid_from = date '2026-08-03';

insert into public.branch_locations (
  branch_id,
  label,
  address,
  maps_url,
  valid_from,
  valid_until
)
select
  id,
  'Plaza Real · ALFAO Business Center',
  'Plaza Real, Av. Dr. José Eleuterio González 315, SUB-4, Jardines del Cerro, Monterrey, N.L., C.P. 64050. Segundo piso, dentro de ALFAO Business Center.',
  'https://maps.app.goo.gl/HE2SPPVTPo27Zh2U6',
  date '2026-08-03',
  null
from public.branches
where code = 'MTY_SUR'
on conflict (branch_id, valid_from) do update set
  label = excluded.label,
  address = excluded.address,
  maps_url = excluded.maps_url,
  valid_until = excluded.valid_until,
  updated_at = now();

select pg_notify('pgrst', 'reload schema');
