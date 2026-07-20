-- Conserva quién respondió cada mensaje enviado desde el panel interno.
alter table public.whatsapp_messages
add column if not exists sent_by_email text;

