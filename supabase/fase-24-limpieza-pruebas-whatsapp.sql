-- Permite que las rutas internas protegidas eliminen conversaciones de prueba.
-- El acceso sigue limitado al servidor mediante la llave service_role.
grant delete on public.whatsapp_conversations, public.whatsapp_messages to service_role;
