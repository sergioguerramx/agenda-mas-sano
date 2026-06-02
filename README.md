# agenda-mas-sano

Aplicacion web para agenda de citas de Mas Sano Nutricion Holistica.

## Estado de esta fase

Esta fase deja la base inicial lista para revision:

- Agenda publica mobile-first.
- Seleccion de fecha y horario.
- Captura de nombre, apellidos y WhatsApp.
- Confirmacion visual y boton de WhatsApp.
- Panel interno en `/panel`.
- Login preparado para Supabase Auth con Google.
- Lista mock de citas con filtros y cambio de estado.
- Esquema SQL inicial para Supabase.
- Placeholders para Google Calendar, Google Contacts y Resend.
- Configuracion preparada para conectar Supabase en la siguiente fase.

Todavia no conecta servicios reales ni usa claves privadas.

## Correr localmente

Requisito: Node.js 20.9 o superior.

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000` para la agenda publica y `http://localhost:3000/panel` para el panel interno.

## Variables pendientes

Crear un archivo `.env.local` a partir de `.env.example` cuando se vaya a conectar la siguiente fase.

Variables preparadas:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_CONTACTS_GROUP_ID`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_WHATSAPP_PHONE`

No se deben subir secretos reales al repositorio.

## Reglas de agenda

- Lunes, martes, jueves y viernes: 9:20 a 13:20 y 15:00 a 19:00.
- Sabado: 10:00 a 15:00.
- Miercoles y domingo cerrado.
- Intervalos de 20 minutos.
- Maximo 2 citas por intervalo.
- Minimo 30 minutos de anticipacion.
- Maximo 15 dias hacia adelante.

## WhatsApp

La app acepta numeros mexicanos de 10 digitos. Tambien tolera `+52`, espacios y guiones. Internamente se normaliza a formato `+52`.

## Supabase

El archivo `supabase/schema.sql` contiene las tablas iniciales:

- `appointments`
- `admin_users`

Tambien agrega los correos permitidos para el panel:

- `info.mas.sano@gmail.com`
- `ms.suc.puentes@gmail.com`

Para conectar Supabase en la siguiente fase:

1. Crear el proyecto en Supabase.
2. Ejecutar `supabase/schema.sql`.
3. Activar Google como proveedor de autenticacion.
4. Completar las variables de Supabase en `.env.local`.
5. Reemplazar los datos mock por consultas reales a Supabase.
6. Mantener Supabase como fuente principal de verdad para citas y administradores.

## Google Calendar

El archivo `src/services/google-calendar.ts` contiene un placeholder. En la siguiente fase se debe:

1. Crear credenciales OAuth en Google Cloud.
2. Guardar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALENDAR_ID`.
3. Crear eventos al confirmar una cita.
4. Guardar el id del evento en `appointments.google_calendar_event_id`.
5. Manejar cambios o cancelaciones actualizando el evento existente.

## Google Contacts

El archivo `src/services/google-contacts.ts` contiene un placeholder. En la siguiente fase se debe:

1. Activar People API en Google Cloud.
2. Guardar el grupo de contactos en `GOOGLE_CONTACTS_GROUP_ID`.
3. Crear o actualizar el contacto del paciente.
4. Guardar el id del contacto en `appointments.google_contact_id`.
5. Evitar duplicados buscando por WhatsApp antes de crear un contacto nuevo.

## Resend

El archivo `src/services/resend.ts` contiene un placeholder. En la siguiente fase se debe:

1. Crear cuenta y dominio en Resend.
2. Guardar `RESEND_API_KEY` y `RESEND_FROM_EMAIL`.
3. Enviar confirmaciones de cita.
4. Guardar el id del envio en `appointments.resend_email_id`.
5. Agregar plantillas de correo para confirmacion, cambio y cancelacion.

## Vercel

Para conectar Vercel despues:

1. Importar el repositorio.
2. Configurar las variables de entorno.
3. Confirmar que el build corre correctamente.
4. Usar Supabase como fuente principal de verdad.
5. Publicar primero en preview y validar el flujo completo antes de produccion.
