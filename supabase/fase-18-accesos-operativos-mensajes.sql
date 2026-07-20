-- Accesos operativos limitados a la bandeja de WhatsApp y al agendado.
-- Estos correos no forman parte del panel administrativo general.

create table if not exists public.message_access_users (
  email text primary key check (email = lower(email)),
  active boolean not null default true,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.message_access_users (email, active, created_by_email)
values
  ('ms.suc.puentes@gmail.com', true, 'info.mas.sano@gmail.com'),
  ('ms.suc.mty@gmail.com', true, 'info.mas.sano@gmail.com')
on conflict (email) do update set
  active = excluded.active,
  updated_at = now();

-- San Nicolás deja de tener acceso al panel administrativo completo.
delete from public.admin_users
where email in ('ms.suc.puentes@gmail.com', 'ms.suc.mty@gmail.com');

alter table public.message_access_users enable row level security;

drop policy if exists "Message users read own access" on public.message_access_users;
create policy "Message users read own access"
on public.message_access_users
for select
using (
  email = lower(auth.jwt() ->> 'email')
  or exists (
    select 1 from public.admin_users
    where admin_users.email = lower(auth.jwt() ->> 'email')
  )
);

drop policy if exists "Message users read conversations" on public.whatsapp_conversations;
create policy "Message users read conversations"
on public.whatsapp_conversations
for select
using (exists (
  select 1 from public.message_access_users
  where message_access_users.email = lower(auth.jwt() ->> 'email')
    and message_access_users.active
));

drop policy if exists "Message users read messages" on public.whatsapp_messages;
create policy "Message users read messages"
on public.whatsapp_messages
for select
using (exists (
  select 1 from public.message_access_users
  where message_access_users.email = lower(auth.jwt() ->> 'email')
    and message_access_users.active
));

grant select on public.message_access_users to authenticated;
grant select on public.whatsapp_conversations to authenticated;
grant select on public.whatsapp_messages to authenticated;
grant select, insert, update, delete on public.message_access_users to service_role;
