alter table public.patient_profiles
alter column promotional_consent set default 1;

create or replace function public.apply_general_promotional_consent_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.promotional_consent = 0 then
    new.promotional_consent := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists patient_profiles_general_promotional_consent on public.patient_profiles;
create trigger patient_profiles_general_promotional_consent
before insert on public.patient_profiles
for each row execute function public.apply_general_promotional_consent_on_insert();

update public.patient_profiles
set promotional_consent = 1,
    updated_at = now()
where promotional_consent <> 1;

select jsonb_build_object(
  'pacientes_totales', count(*),
  'consentimiento_activo', count(*) filter (where promotional_consent = 1),
  'consentimiento_inactivo', count(*) filter (where promotional_consent <> 1)
) as resultado
from public.patient_profiles;
