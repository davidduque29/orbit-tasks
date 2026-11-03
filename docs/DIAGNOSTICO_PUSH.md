# Diagnóstico de notificaciones Web Push — Orbit Tasks

## Dónde están los datos

- `public.events`: eventos y su fecha de inicio (`starts_at`), con excepciones por evento en `reminder_override_minutes`.
- `public.tasks`: tareas con vencimiento (`estimated_due_at`), estado y excepciones por tarea.
- `public.notification_preferences`: anticipaciones por defecto, repetición de tareas vencidas, horario de silencio y zona horaria.
- `public.device_subscriptions`: suscripciones push por usuario/dispositivo. **No compartir ni exportar `subscription_data` ni la URL de endpoint**.
- `public.push_delivery_log`: cada intento procesado de aviso push por dispositivo, estado de entrega al servicio push, código HTTP y diagnóstico de errores.
- `public.reminders`: tabla heredada disponible, **el flujo actual de `send-push` no inserta automáticamente filas aquí**. Los avisos candidatos se calculan directamente desde eventos/tareas y preferencias al ejecutar Cron.

## Campos de push_delivery_log

- `notification_key`: identidad lógica del aviso (evento/tarea, momento, fecha).
- `state`: `reserved` (en procesamiento), `sent` (aceptado por el proveedor push), `failed` (error).
- `http_status`: respuesta HTTP del proveedor, cuando existe.
- `error_message`: descripción técnica **recortada/saneada**, sin secretos ni endpoints.
- `attempts`: cantidad de intentos (máximo 3).
- `last_attempt_at`, `next_retry_at`, `sent_at`: trazabilidad de intentos/reintentos/aceptación.

**Importante:** `sent` prueba aceptación por el proveedor push, no que la notificación haya aparecido en la pantalla del celular.

## Consultas útiles desde SQL Editor

```sql
-- Intentos más recientes y motivo técnico
select notification_key, state, attempts, http_status,
       error_message, last_attempt_at, next_retry_at, sent_at
from public.push_delivery_log
order by created_at desc limit 25;

-- Resumen del estado
select state, count(*) from public.push_delivery_log group by state;

-- Suscripciones registradas (sin exponer claves de suscripción)
select platform, enabled, created_at, updated_at
from public.device_subscriptions order by created_at desc;

-- Cron reciente: que el SQL se ejecutó, no necesariamente que Web Push se entregó
select d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where j.jobname = 'orbit-push-reminders'
order by d.start_time desc limit 10;

-- Respuestas HTTP de pg_net (almacenamiento temporal)
select status_code, content::text as result, created
from net._http_response order by created desc limit 10;
```

## Logs en el panel

1. Supabase Dashboard → **Edge Functions → send-push → Logs**: ejecución, excepciones y mensajes `web_push_delivery_failed`. También puede usarse **Observability → Logs** para buscar por función.
2. **Integrations → Cron → Jobs → orbit-push-reminders**: últimas ejecuciones de SQL. `succeeded` significa que Cron ejecutó el comando, no que el teléfono recibió el mensaje.
3. **Database → Table Editor → push_delivery_log**: intentos de envío persistidos.
4. **Database → Table Editor → device_subscriptions**: registros de dispositivos. No mostrar el campo `subscription_data` en capturas públicas.

## Diagnóstico del primer fallo

En la prueba del evento "Salida a comer" (3 de noviembre de 2026, 6:20 p. m. Colombia), `send-push` devolvió `checked=1, sent=0, failed=1`. La versión anterior borraba la fila fallida: **no es posible recuperar de esa fila el detalle perdido**. La función actualizada (v5) guarda el próximo error y permite reintentos limitados.

Para repetir la prueba: abrir la PWA instalada en iPhone, confirmar que el permiso esté activo, crear un evento en el futuro (al menos 10 minutos), seleccionar aviso 5 minutos antes o al comienzo, cerrar la PWA y verificar primero `push_delivery_log` y luego el dispositivo. La primera prueba real puede requerir re-suscripción si la clave VAPID o la suscripción no coinciden.

**Advertencia de seguridad:** `send-push` se invoca con el token secreto `PUSH_SCHEDULER_TOKEN`; no publicar ese valor, la clave privada VAPID ni valores completos de suscripciones.
