# agenda-mas-sano

Aplicacion web para agenda de citas de Mas Sano Nutricion Holistica.

## Estado de esta fase

El proyecto ya conecta la agenda publica y el panel interno con Supabase real.

- Agenda publica mobile-first.
- Seleccion de fecha y horario.
- Captura de nombre, apellidos y WhatsApp.
- Guardado real de citas en estado pendiente.
- Creacion de evento en Google Calendar desde que la cita queda pendiente.
- Correo interno a Mas Sano cuando entra una nueva cita, si Resend esta configurado.
- Panel interno en `/panel`.
- Login con Supabase Auth y Google.
- Lista real de citas con filtros, cambio de estado y copiado de WhatsApp.
- Contactos internos en Supabase con busqueda y exportacion CSV.
- Bandeja interna para recibir y contestar mensajes del numero de campañas.

## Correr localmente

Requisito: Node.js 20.9 o superior.

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000` para la agenda publica y `http://localhost:3000/panel` para el panel interno.

## Variables pendientes

Crear un archivo `.env.local` a partir de `.env.example` para desarrollo local. En Vercel, configurar las mismas variables desde Environment Variables.

Variables preparadas:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_CALENDAR_TIME_ZONE`
- `GOOGLE_CALENDAR_EVENT_DURATION_MINUTES`
- `GOOGLE_CONTACTS_CLIENT_ID`
- `GOOGLE_CONTACTS_CLIENT_SECRET`
- `GOOGLE_CONTACTS_REFRESH_TOKEN`
- `GOOGLE_CONTACTS_GROUP_ID`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `INTERNAL_NOTIFY_EMAIL`
- `NEXT_PUBLIC_WHATSAPP_PHONE`
- `YOSOYSANO_BOOKING_TOKEN_SECRET`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_VERIFY_TOKEN`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`

No se deben subir secretos reales al repositorio.

## Bandeja de WhatsApp

La ruta `/panel/mensajes` concentra las conversaciones del numero de campañas. Relaciona el WhatsApp con los pacientes existentes sin fusionar familiares que comparten contacto.

Para activarla:

1. Ejecutar `supabase/fase-15-bandeja-whatsapp.sql`.
2. Configurar las variables de Meta en Vercel.
3. Registrar `https://agenda.massanonh.com/api/whatsapp/webhook` como webhook de WhatsApp.
4. Suscribir el campo `messages`.

Los mensajes de texto se contestan desde el panel. Para volver a iniciar una conversación después de la ventana permitida por WhatsApp se usará una plantilla aprobada; esa parte se preparará con la campaña piloto.

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
- `contacts`

Tambien agrega los correos permitidos para el panel:

- `info.mas.sano@gmail.com`
- `ms.suc.puentes@gmail.com`

Para conectar Supabase:

1. Crear el proyecto en Supabase.
2. Ejecutar `supabase/schema.sql`.
3. Activar Google como proveedor de autenticacion.
4. Completar las variables de Supabase en `.env.local`.
5. Mantener Supabase como fuente principal de verdad para citas, contactos y administradores.

### Base historica optimizada

`supabase/fase-11-pacientes-historial-optimizado.sql` prepara una estructura adicional que no interrumpe la agenda actual:

- Pacientes separados de sus citas, permitiendo familiares con el mismo WhatsApp.
- Historial compacto con sucursal, fecha, confirmacion, asistencia y cita liberada a las 8:00.
- Segmentos calculados al consultar, sin guardar copias innecesarias.
- Calendarios separados para San Nicolás y Monterrey Poniente.
- Registro minimo de campañas y exclusiones, sin guardar notas clinicas.
- Reflejo automatico de las citas nuevas que ya genera la pagina.
- Consentimiento promocional activo por la autorizacion fisica general; una exclusion expresa siempre tiene prioridad.

La migracion historica se prepara primero en modo local con:

```bash
npm run prepare:historical-import -- --input=/ruta/processed_cleaned.json --branch=MTY_SUR --limit=100
```

Este comando no escribe en Supabase y no incluye los textos originales de Calendar.

### Yo Soy Sano Online

La agenda puede recibir llamadas online de Yo Soy Sano despues de que la clienta llena su registro en `yosoysano.com`.

Ruta privada:

`/agendar/yosoysano/[token]`

Reglas:

- Solo se puede entrar con un enlace generado desde Yo Soy Sano.
- No se agenda Plan Express.
- Las citas se guardan como `Yo Soy Sano Online`.
- Los eventos en Google Calendar se crean como `YSS ONLINE $399 - Nombre` o `YSS PAQUETE - Nombre`.
- La disponibilidad es la misma de Más Sano; si un horario ya esta ocupado en Google Calendar, no aparece disponible.

Para activarlo:

1. Ejecutar `supabase/fase-8-yosoysano-online.sql` en Supabase.
2. Configurar la misma clave privada `YOSOYSANO_BOOKING_TOKEN_SECRET` en Vercel para:
   - `yosoysano-platform`
   - `agenda-mas-sano`
3. Confirmar que `NEXT_PUBLIC_AGENDA_URL` en Yo Soy Sano apunte a `https://agenda.massanonh.com`.

### Login del panel

Para que el login del panel regrese correctamente a `/panel`, Supabase Auth debe tener estas Redirect URLs permitidas:

- `https://agenda-mas-sano.vercel.app/auth/callback`
- `https://agenda-mas-sano.vercel.app/auth/panel-callback`
- `https://agenda-mas-sano-git-fase-4-contactos-mas-sano-s-projects.vercel.app/auth/callback`
- `https://agenda-mas-sano-git-fase-4-contactos-mas-sano-s-projects.vercel.app/auth/panel-callback`
- Cualquier nueva URL de preview que Vercel genere para probar PRs, terminando en `/auth/callback` y `/auth/panel-callback`.

Ruta en Supabase:

Supabase -> Authentication -> URL Configuration -> Redirect URLs.

## Google Calendar

Google Calendar se usa para bloquear el espacio desde que la cita queda en estado pendiente.

Para activarlo:

1. Crear una cuenta de servicio en Google Cloud.
2. Compartir el calendario destino con el correo de esa cuenta de servicio.
3. Guardar en Vercel:
   - `GOOGLE_CALENDAR_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_CALENDAR_TIME_ZONE`
4. Al crear una cita, se crea un evento pendiente y se guarda su ID en `appointments.google_calendar_event_id`.
5. Al cambiar estado desde el panel, el evento se actualiza. Si la cita se cancela, el evento se elimina.

## Contactos internos y Google Contacts

Los contactos internos en Supabase siguen siendo la fuente estable. Google Contacts se puede activar despues con OAuth de una cuenta Google autorizada.

Para activar contactos internos:

1. Ejecutar `supabase/fase-4-contactos.sql` en Supabase.
2. Cada cita nueva crea o actualiza un contacto usando WhatsApp para evitar duplicados.
3. El panel muestra la pestaña Contactos con busqueda, copiado de WhatsApp e historial basico.
4. El panel permite exportar contactos a CSV.

Para activar Google Contacts:

1. Activar Google People API en Google Cloud.
2. Crear credenciales OAuth para la cuenta Google que recibira los contactos.
3. Autorizar el permiso de contactos y generar un refresh token.
4. Guardar en Vercel:
   - `GOOGLE_CONTACTS_CLIENT_ID`
   - `GOOGLE_CONTACTS_CLIENT_SECRET`
   - `GOOGLE_CONTACTS_REFRESH_TOKEN`
   - `GOOGLE_CONTACTS_GROUP_ID` si quieres mandar los contactos a una etiqueta/grupo especifico.
5. Cada cita nueva intentara crear o actualizar el contacto en Google Contacts usando el WhatsApp. Si Google Contacts falla, la cita y Google Calendar no se rompen.

## Resend

Correo interno por Resend pendiente hasta verificar dominio massanonh.com.

Resend es opcional. Si faltan `RESEND_API_KEY` o `RESEND_FROM_EMAIL`, la cita se guarda y Google Calendar sigue funcionando. Si Resend falla, solo se registra el aviso interno en logs y no se muestra error al paciente.

Para activarlo despues:

1. Verificar el dominio `massanonh.com` en Resend.
2. Guardar en Vercel:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `INTERNAL_NOTIFY_EMAIL`
3. Cuando entra una cita nueva, se manda un correo interno a `info.mas.sano@gmail.com` o al correo configurado.
4. El ID del envio se guarda en `appointments.resend_email_id`.

## Vercel

Para conectar Vercel despues:

1. Importar el repositorio.
2. Configurar las variables de entorno.
3. Confirmar que el build corre correctamente.
4. Usar Supabase como fuente principal de verdad.
5. Publicar primero en preview y validar el flujo completo antes de produccion.
