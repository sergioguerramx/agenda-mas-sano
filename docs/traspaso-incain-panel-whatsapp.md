# Documento de traspaso: panel de WhatsApp y base de datos para INCAIN

## 1. Objetivo del nuevo proyecto

Crear para INCAIN un sistema similar al de Más Sano que permita:

- Recibir y responder desde una página interna los mensajes del WhatsApp de INCAIN.
- Guardar automáticamente las conversaciones y su estado.
- Crear una base central de prospectos, alumnos y exalumnos.
- Importar y ordenar Google Contacts y otras listas históricas.
- Identificar de dónde llegó cada persona: anuncio de Meta, sitio web, recomendación, Google Contacts u otra fuente.
- Dar seguimiento comercial sin depender exclusivamente del teléfono donde está instalado WhatsApp.
- Permitir acceso limitado al personal, sin exponer configuraciones ni toda la base.
- Preparar campañas futuras de seguimiento y reactivación respetando las bajas de publicidad.
- Vincular el panel con `incain.com`, preferentemente mediante un subdominio como `panel.incain.com` o `mensajes.incain.com`.

La recomendación es reutilizar la experiencia y la estructura de Más Sano, pero mantener una base independiente para INCAIN. No se deben mezclar pacientes, alumnos, conversaciones, calendarios, contactos ni permisos entre ambas marcas.

## 2. Qué se construyó para Más Sano

El sistema actual vive en `https://agenda.massanonh.com` y reúne cinco áreas:

1. Agenda pública para crear citas.
2. Panel administrativo general.
3. Bandeja de WhatsApp para administración.
4. Bandeja limitada para el personal de sucursales.
5. Base central en Supabase, conectada con Google Calendar, Google Contacts y Meta WhatsApp.

La página está publicada en Vercel. Supabase es la fuente principal de información. Google Calendar bloquea y refleja los horarios, mientras que Meta conecta el número de WhatsApp y entrega los mensajes al panel.

## 3. Base de datos que quedó preparada

### Personas y contactos

- `patient_profiles`: una persona por registro, con nombre, WhatsApp, estado del teléfono, consentimiento y clave de origen.
- Permite conservar varias personas con el mismo WhatsApp, como familiares.
- `contacts`: resumen operativo por WhatsApp para buscar y exportar con rapidez.
- `contact_suppressions`: lista protegida de personas que no deben recibir promociones.

### Citas e historial

- `appointments`: citas actuales creadas por la página o desde la conversación de WhatsApp.
- `patient_appointment_history`: historial compacto de cada persona.
- Conserva sucursal, fecha, hora original, número de secuencia, confirmación, asistencia, cancelación y citas liberadas.
- Cada nueva cita se refleja automáticamente en el historial.

### Sucursales y servicios

- `branches`: sucursales, estado activo y calendario relacionado.
- `nutritionists`: personal relacionado con sucursales.
- `services_catalog`: servicios disponibles.
- `calendar_sync_sources`: preparación para sincronizar calendarios de manera continua.

### WhatsApp

- `whatsapp_conversations`: una conversación por número, con nombre, mensajes pendientes, estado comercial, sucursal de interés y nota administrativa.
- `whatsapp_messages`: una fila por mensaje recibido o enviado, incluyendo estado de envío, entrega, lectura y quién respondió.
- `message_access_users`: correos autorizados para operar únicamente la bandeja de mensajes.

### Seguimiento y campañas

- `retargeting_campaigns`: campañas preparadas por segmento.
- `retargeting_messages`: control de destinatarios y resultados.
- Vistas que calculan segmentos sin duplicar información innecesaria.

Los segmentos preparados incluyen: activa, seguimiento, inactiva, reactivación, primera consulta sin regreso, agendó y no acudió, sin asistencia comprobada y con cita futura.

Importante: la estructura de campañas existe, pero el envío masivo de retargeting todavía no debe considerarse terminado ni activado.

## 4. Funcionamiento de la bandeja de WhatsApp

El número de campañas de Más Sano es `+52 81 8693 5634`.

Cuando llega un mensaje:

1. Meta lo envía al sistema.
2. Se normaliza el número a formato internacional.
3. Se crea o actualiza la conversación.
4. El mensaje aparece como pendiente en la bandeja.
5. La operadora puede responder desde la página.
6. Se guarda si el mensaje fue enviado, entregado, leído o rechazado.
7. Se registra quién respondió.

El panel muestra:

- Nombre y WhatsApp.
- Conversaciones pendientes.
- Buscador.
- Filtro por estado.
- Respuestas rápidas.
- Estado de entrega y lectura.
- Nombre del responsable que contestó.
- Agendado directo en San Nicolás o Monterrey Poniente.
- En el panel administrativo, coincidencias con pacientes e historial resumido.

Los estados de conversación son: nuevo, interesado, cita agendada, dar seguimiento, no interesado, atención cerrada y no contactar.

## 5. Accesos y seguridad

Hay dos niveles:

- Administración: puede ver agenda, contactos, historial, mensajes, integraciones y accesos.
- Personal operativo: entra únicamente a `/mensajes`, responde y agenda; no ve la base completa ni la configuración.

Actualmente tienen acceso operativo:

- `ms.suc.puentes@gmail.com`
- `ms.suc.mty@gmail.com`

La administración puede agregar o retirar correos desde la página de accesos. Cada mensaje enviado conserva el responsable: Administrador, San Nicolás, Monterrey Poniente o Automatización.

Para INCAIN debe crearse una lista independiente de correos autorizados y una cuenta administradora propia.

## 6. Agenda y reglas actuales de Más Sano

- Lunes, martes, jueves y viernes: 9:20 a.m. a 1:20 p.m. y 3:00 p.m. a 7:00 p.m.
- Sábado: 10:00 a.m. a 3:00 p.m.
- Miércoles y domingo: cerrado.
- Intervalos de 20 minutos.
- Máximo habitual de dos citas por intervalo.
- Hasta 15 días hacia adelante.
- Mínimo de 30 minutos para agendar el mismo día.
- La última hora mostrada representa la última cita disponible.

Desde la conversación se puede elegir sucursal, fecha y un horario realmente libre. Al confirmar, se guarda en Supabase y se crea el evento en el Google Calendar correcto.

Una cita para el mismo día o el día siguiente queda confirmada desde su creación. Las posteriores quedan pendientes de confirmación.

## 7. Confirmaciones automáticas

Se construyeron tres botones en WhatsApp:

- Sí, confirmo.
- Quiero reagendar.
- No podré asistir.

Resultado de cada opción:

- Sí, confirmo: la cita cambia a confirmada y aparece `✔️` en Google Calendar.
- Quiero reagendar: libera el horario, mueve el registro a las 8:00 a.m., conserva la hora original, marca `REAGENDAR` y deja la conversación en seguimiento.
- No podré asistir: libera el horario, mueve el registro a las 8:00 a.m., conserva la hora original y marca `CANCELÓ`.

Las tres rutas se probaron correctamente con un número controlado. Después se eliminaron los datos y eventos de prueba.

Programa definido:

- Citas del lunes: primer mensaje el sábado a las 12:00 p.m.; segundo el sábado a las 6:00 p.m.
- Citas del martes: lunes a las 10:00 a.m. y 6:00 p.m.
- Citas del jueves: miércoles a las 10:00 a.m. y 6:00 p.m.
- Citas del viernes: jueves a las 10:00 a.m. y 6:00 p.m.
- Citas del sábado: jueves a las 10:00 a.m. y 6:00 p.m.
- Si no responde después de ambos avisos: el mismo día, a las 8:00 a.m., se libera el horario y se envía un aviso.

El sistema evita interpretar frases ambiguas como “te confirmo más tarde”. Solo actúa ante botones o respuestas claramente reconocidas.

Las plantillas creadas en Meta son:

- `mas_sano_confirmacion_cita`
- `mas_sano_segunda_confirmacion`
- `mas_sano_cita_liberada`

Antes de activar el envío real se debe verificar que Meta las haya aprobado.

## 8. Meta Ads a WhatsApp

El sistema reconoce cuando el primer mensaje llegó desde un anuncio de Meta a WhatsApp. En ese caso puede enviar una bienvenida inicial y preguntar la sucursal de interés.

Dentro de las 24 horas posteriores al mensaje del cliente se puede conversar normalmente. Fuera de ese periodo, Meta exige una plantilla aprobada para reiniciar la conversación.

Para INCAIN se puede adaptar la bienvenida a preguntas como:

- Curso o diplomado de interés.
- Modalidad presencial u online.
- Ciudad.
- Fecha de inicio.
- Solicitud de costos.

## 9. Google Contacts

El sistema conserva primero el contacto en Supabase. Google Contacts es una copia operativa opcional, no la fuente principal.

El proceso preparado:

1. Detecta contactos pendientes.
2. Busca por número de teléfono para evitar duplicados.
3. Crea o actualiza el contacto.
4. Puede asignarlo a una etiqueta de Google Contacts.
5. Guarda el nombre, WhatsApp, origen, sucursal, fecha de cita y estado.
6. Si Google Contacts falla, la cita y la base principal continúan funcionando.

Para INCAIN conviene importar primero Google Contacts a una base nueva, revisar duplicados y después habilitar la sincronización. Los campos sugeridos son nombre, WhatsApp, correo, curso de interés, curso adquirido, modalidad, generación, origen, última interacción y estado comercial.

Si varias personas comparten un mismo teléfono, Supabase debe conservarlas separadas; Google Contacts puede seguir funcionando como un resumen por número.

## 10. Lo que todavía debe corregirse en Más Sano

Antes de campañas reales hay que revisar todos los textos. Actualmente varias respuestas rápidas y mensajes todavía muestran `$399`.

La regla acordada es:

- Desde el 3 de agosto, pacientes nuevos o personas que retomen después de perder continuidad pagan `$449`.
- Conservan `$399` quienes continúen su paquete con citas cada 15 días.

También falta:

- Confirmar la aprobación final del nombre, fotografía y plantillas en Meta.
- Revisar dirección, mapa y textos finales por sucursal.
- Hacer una prueba programada real, no solo inmediata.
- Definir y activar los primeros segmentos de retargeting.
- Revisar el método de baja y exclusión antes de mensajes masivos.

## 11. Qué debe reutilizarse para INCAIN

Se puede reutilizar:

- Diseño de la bandeja.
- Inicio de sesión con Google.
- Accesos limitados por correo.
- Recepción y respuesta de WhatsApp.
- Estados de envío, entrega y lectura.
- Identificación del responsable.
- Buscador, pendientes y respuestas rápidas.
- Bienvenida automática para anuncios de Meta.
- Base de contactos e historial.
- Google Contacts.
- Segmentación y exclusiones.
- Publicación en Vercel y conexión con Supabase.

No debe copiarse directamente:

- La base de pacientes.
- Los calendarios de las sucursales.
- Las plantillas de Más Sano.
- Los nombres de servicios, precios y direcciones.
- Los accesos del personal de Más Sano.
- Las claves privadas de Meta, Google o Supabase.

## 12. Base recomendada para INCAIN

### Personas

- Nombre completo.
- WhatsApp normalizado.
- Correo.
- Ciudad.
- Fuente de captación.
- Fecha de primer contacto.
- Fecha de última interacción.
- Autorización promocional.
- No contactar.

### Interés y formación

- Curso, diplomado o programa de interés.
- Modalidad.
- Generación o fecha de inicio.
- Estado: prospecto, información enviada, interesado, pago pendiente, inscrito, alumno activo, egresado, seguimiento, no interesado o no contactar.
- Asesor responsable.

### Historial

- Una fila por conversación importante, inscripción, cita informativa o cambio de estado.
- Origen del registro.
- Fecha.
- Programa relacionado.
- Resultado.
- Observación administrativa breve.

### Mensajes

- Conversación por WhatsApp.
- Mensajes enviados y recibidos.
- Estado de entrega.
- Responsable.
- Plantilla utilizada.
- Anuncio de origen cuando Meta lo informe.

No se deben guardar contraseñas, datos de tarjetas ni información innecesaria de pagos.

## 13. Decisiones necesarias antes de construir INCAIN

### Decisión confirmada sobre el número

- Número destinado a automatizaciones y atención desde el nuevo panel: `81 2576 1735`.
- El número `81 3246 9930` permanece como número oficial actual de INCAIN y no se conectará al nuevo panel por ahora.

### Decisiones restantes

1. Confirmar si el `81 2576 1735` se atenderá solamente desde el panel o si se buscará conservar también alguna forma de uso móvil compatible.
2. Elegir el subdominio: recomendación `panel.incain.com`.
3. Definir los correos administradores y operadores.
4. Definir los cursos y estados comerciales iniciales.
5. Elegir qué cuenta de Google Contacts se conectará.
6. Entregar una exportación piloto de Google Contacts o una lista pequeña.
7. Definir las respuestas rápidas y la bienvenida de anuncios.
8. Confirmar si INCAIN necesita agenda de llamadas, visitas o clases demostrativas.
9. Mantener una lista de exclusión independiente.

## 14. Orden recomendado para el proyecto INCAIN

1. Crear proyecto separado y subdominio.
2. Crear Supabase independiente.
3. Copiar únicamente la estructura del panel, no los datos.
4. Conectar el número elegido de WhatsApp en Meta.
5. Activar recepción y respuesta manual.
6. Crear accesos de administración y operadores.
7. Importar una muestra de Google Contacts.
8. Limpiar duplicados y aprobar la estructura.
9. Añadir cursos, estados y respuestas rápidas.
10. Probar envío, recepción, entrega y lectura con números controlados.
11. Conectar anuncios de Meta a WhatsApp.
12. Crear automatizaciones gradualmente.
13. Importar el resto de los contactos.
14. Activar segmentos y seguimiento solamente después de validar exclusiones.

## 15. Información que nunca debe compartirse entre proyectos

- Claves de Supabase.
- Claves y tokens de Meta.
- Credenciales de Google.
- Base de pacientes de Más Sano.
- Conversaciones de Más Sano.
- Datos clínicos.
- Listas de exclusión sin una razón legítima de migración.

## 16. Referencia para Codex

El sistema de referencia está en:

`/Users/sergio/Documents/WEB MÁS SANO/agenda-mas-sano-repo`

Las piezas principales son:

- Bandeja: `src/components/WhatsAppInbox.tsx`
- Recepción de Meta: `src/app/api/whatsapp/webhook/route.ts`
- Envío manual: `src/app/api/admin/whatsapp/send/route.ts`
- Agendado desde WhatsApp: `src/app/api/admin/whatsapp/schedule/route.ts`
- Confirmaciones: `src/services/appointment-confirmations.ts`
- Conexión Meta: `src/lib/meta-whatsapp.ts`
- Google Calendar: `src/services/google-calendar.ts`
- Google Contacts: `src/services/google-contacts.ts`
- Horarios: `src/lib/schedule.ts`
- Accesos limitados: `src/components/MessageAccessManager.tsx`
- Estructura de base: archivos `supabase/fase-11` a `supabase/fase-20`.

La última versión validada incluye botones de confirmar, reagendar y cancelar. No deben copiarse valores, marcas, teléfonos ni claves; únicamente la lógica general.
