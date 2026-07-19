drop trigger if exists mirror_operational_appointment_history on public.appointments;
drop function if exists public.mirror_operational_appointment_to_history();
drop function if exists public.sync_operational_appointment_to_history(uuid);

drop view if exists public.patient_activity_summary;
drop view if exists public.patient_branch_activity;

drop table if exists public.retargeting_messages;
drop table if exists public.retargeting_campaigns;
drop table if exists public.contact_suppressions;
drop table if exists public.calendar_sync_sources;
drop table if exists public.patient_appointment_history;
drop table if exists public.patient_profiles;
drop table if exists public.services_catalog;
drop table if exists public.nutritionists;
drop table if exists public.branches;

select pg_notify('pgrst', 'reload schema');
