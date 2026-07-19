drop index if exists public.patient_history_calendar_event_unique;

create index if not exists patient_history_calendar_event_idx
on public.patient_appointment_history (branch_id, calendar_event_id)
where calendar_event_id is not null;

update public.patient_appointment_history h
set source_event_key = b.code || ':' || h.calendar_event_id || ':' || p.source_patient_key,
    updated_at = now()
from public.patient_profiles p,
     public.branches b
where h.patient_id = p.id
  and h.branch_id = b.id
  and h.source_kind = 3
  and h.calendar_event_id is not null
  and p.source_patient_key is not null
  and h.source_event_key <> b.code || ':' || h.calendar_event_id || ':' || p.source_patient_key;

select jsonb_build_object(
  'citas_historicas', count(*),
  'eventos_calendar', count(distinct calendar_event_id),
  'eventos_compartidos', count(*) - count(distinct calendar_event_id),
  'claves_unicas', count(distinct source_event_key)
) as resultado
from public.patient_appointment_history
where source_kind = 3;
