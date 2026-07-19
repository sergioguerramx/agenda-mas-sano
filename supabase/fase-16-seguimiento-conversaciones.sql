-- Herramientas administrativas para convertir la bandeja en seguimiento operativo.
-- No guarda informacion clinica; solo estado comercial, sucursal de interes y nota administrativa.

alter table public.whatsapp_conversations
  add column if not exists workflow_status text not null default 'nuevo',
  add column if not exists branch_interest text,
  add column if not exists admin_note text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists updated_by_email text;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_workflow_status_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_workflow_status_check
  check (workflow_status in (
    'nuevo',
    'interesado',
    'cita_agendada',
    'seguimiento',
    'no_interesado',
    'cerrado',
    'no_contactar'
  ));

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_branch_interest_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_branch_interest_check
  check (branch_interest is null or branch_interest in ('SN', 'MTY_SUR', 'POR_CONFIRMAR'));

create index if not exists whatsapp_conversations_workflow_idx
on public.whatsapp_conversations (workflow_status, last_message_at desc);

create index if not exists whatsapp_conversations_follow_up_idx
on public.whatsapp_conversations (follow_up_at)
where follow_up_at is not null;

select pg_notify('pgrst', 'reload schema');
