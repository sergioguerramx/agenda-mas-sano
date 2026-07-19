select
  (select count(*) from public.appointments) as citas_actuales,
  (select count(*) from public.patient_profiles) as pacientes_nuevos,
  (select count(*) from public.patient_appointment_history) as citas_en_historial,
  (select count(*) from public.branches) as sucursales,
  (select count(*) from public.patient_appointment_history where released_at_8) as citas_liberadas;

select
  count(*) filter (where whatsapp_status = 1) as whatsapp_validos,
  count(*) filter (where whatsapp_status = 0) as sin_whatsapp,
  count(*) filter (where promotional_consent = 1) as consentimiento_si,
  count(*) filter (where promotional_consent = 0) as consentimiento_sin_evidencia,
  count(*) filter (where promotional_consent = -1) as consentimiento_no
from public.patient_profiles;

select
  b.name as sucursal,
  count(h.id) as citas,
  count(h.id) filter (where h.attended is true) as asistidas,
  count(h.id) filter (where h.confirmed is true and h.attended is not true) as confirmadas_sin_asistencia,
  count(h.id) filter (where h.released_at_8) as liberadas
from public.branches b
left join public.patient_appointment_history h on h.branch_id = b.id
group by b.id, b.name
order by b.name;

select segment_key, count(*)
from public.patient_activity_summary
group by segment_key
order by segment_key;

select count(*) as citas_sin_paciente
from public.patient_appointment_history h
left join public.patient_profiles p on p.id = h.patient_id
where p.id is null;
