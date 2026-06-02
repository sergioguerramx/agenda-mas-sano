# agenda-mas-sano

Aplicacion web para agenda de citas de Mas Sano Nutricion Holistica.

## Estado de esta fase

Esta fase deja la base inicial lista para revision:

- Proyecto Next.js con estructura limpia.
- Agenda publica mobile-first con seleccion de fecha, horario, datos y confirmacion.
- Estilo visual calido, pastel, suave, limpio y profesional.
- Panel interno en `/panel` preparado para Supabase Auth con Google.
- Lista mock de citas con filtro por fecha y estado, cambio de estado y copiado de WhatsApp.
- Reglas base de horarios y validacion de WhatsApp mexicano.
- Esquema SQL inicial para Supabase.
- Placeholders para Google Calendar, Google Contacts y Resend.

Todavia no conecta servicios reales ni usa claves privadas.

## Correr localmente

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000` y `http://localhost:3000/panel`.

## Variables pendientes

Crear `.env.local` a partir de `.env.example` cuando se conecten servicios reales. No subir secretos al repositorio.

Variables preparadas: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CONTACTS_GROUP_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_WHATSAPP_PHONE`.

## Reglas de agenda

- Lunes, martes, jueves y viernes: 9:20 a 13:20 y 15:00 a 19:00.
- Sabado: 10:00 a 15:00.
- Miercoles y domingo cerrado.
- Intervalos de 20 minutos.
- Maximo 2 citas por intervalo.
- Minimo 30 minutos de anticipacion.
- Maximo 15 dias hacia adelante.

## WhatsApp

Acepta 10 digitos mexicanos, tolera `+52`, espacios y guiones, y normaliza a `+52`.

## Supabase

Ejecutar `supabase/schema.sql`, activar Google en Supabase Auth, llenar variables de Supabase y reemplazar datos mock por consultas reales. Supabase sera la fuente principal de verdad.

## Google Calendar, Google Contacts, Resend y Vercel

Los archivos en `src/services` quedan como placeholders. En la siguiente fase se deben crear credenciales reales, guardar las variables en el entorno de Vercel, conectar eventos de calendario, contactos y correos, y guardar los identificadores externos en `appointments`.
