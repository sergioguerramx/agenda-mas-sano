create or replace view public.retargeting_segment_candidates
with (security_invoker = true)
as
select
  p.id as patient_id,
  p.full_name,
  p.whatsapp,
  b.id as branch_id,
  b.code as branch_code,
  b.name as branch_name,
  a.first_appointment_at,
  a.last_appointment_at,
  a.last_attended_at,
  a.total_appointments,
  a.attended_appointments,
  a.confirmed_without_attendance,
  a.released_appointments,
  a.has_future_appointment,
  case
    when coalesce(a.has_future_appointment, false) then 'con_cita_futura'
    when a.attended_appointments = 0 and a.confirmed_without_attendance > 0 then 'agendo_no_acudio'
    when a.attended_appointments = 0 then 'sin_asistencia_comprobada'
    when a.attended_appointments = 1 then 'primera_consulta_sin_regreso'
    when a.last_attended_at >= now() - interval '30 days' then 'activa'
    when a.last_attended_at >= now() - interval '60 days' then 'seguimiento'
    when a.last_attended_at >= now() - interval '120 days' then 'inactiva'
    else 'reactivacion'
  end as segment_key,
  (
    p.whatsapp_status = 1
    and p.promotional_consent = 1
    and not coalesce(a.has_future_appointment, false)
    and not exists (
      select 1
      from public.contact_suppressions s
      where s.contact_fingerprint = encode(digest(p.whatsapp, 'sha256'), 'hex')
    )
  ) as promotion_ready
from public.patient_branch_activity a
join public.patient_profiles p on p.id = a.patient_id
join public.branches b on b.id = a.branch_id;

grant select on public.retargeting_segment_candidates to authenticated, service_role;
revoke all on public.retargeting_segment_candidates from anon;

select
  b.name as sucursal,
  r.segment_key as segmento,
  count(*) filter (where r.promotion_ready)::integer as contactos_disponibles
from public.retargeting_segment_candidates r
join public.branches b on b.id = r.branch_id
group by b.name, r.segment_key
order by b.name, r.segment_key;
