-- Estado mínimo para continuar el agendado conversacional de WhatsApp.
-- No contiene información clínica.

alter table public.whatsapp_conversations
  add column if not exists automation_step text,
  add column if not exists automation_context jsonb not null default '{}'::jsonb,
  add column if not exists automation_started_at timestamptz,
  add column if not exists automation_updated_at timestamptz;

create index if not exists whatsapp_conversations_automation_step_idx
on public.whatsapp_conversations (automation_step, automation_updated_at desc)
where automation_step is not null;

select pg_notify('pgrst', 'reload schema');
