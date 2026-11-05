# Funcionamiento de la Edge Function send-push: cálculo, control y entrega de notificaciones Web Push

**Proyecto:** Orbit Tasks  
**Versión de esta documentación:** 1.0  
**Fecha:** 5 de noviembre de 2026  
**Alcance:** explicación del código de `supabase/functions/send-push/index.ts`.  
**Fuente revisada:** [send-push/index.ts en GitHub](https://github.com/davidduque29/orbit-tasks/blob/main/supabase/functions/send-push/index.ts)

## 1. Propósito

Esta Supabase Edge Function recibe una solicitud autorizada, consulta tareas, eventos y notas con recordatorio, determina cuáles están dentro de su ventana de aviso y envía notificaciones Web Push a los dispositivos habilitados de sus propietarios.

También registra cada entrega por usuario, dispositivo y aviso para evitar duplicados y administrar reintentos. El archivo implementa el procesamiento de cada llamada; no configura ni ejecuta por sí mismo el programador que debe invocarlo.

## 2. Configuración y dependencias

La función importa `web-push 3.6.7` para enviar notificaciones y `@supabase/supabase-js 2.57.0` para consultar y actualizar la base de datos.

Lee estas variables de entorno:

| Variable | Uso |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Clave pública de la aplicación Web Push. |
| `VAPID_PRIVATE_KEY` | Clave privada usada por el servidor al firmar envíos Web Push. |
| `PUSH_SCHEDULER_TOKEN` | Token requerido en el encabezado `x-orbit-scheduler-token` para autorizar la llamada. |
| `SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio usada por esta función del lado servidor. |

Si falta cualquiera de ellas, la función responde con HTTP 503. La clave de servicio y la clave privada VAPID son secretos del servidor: no deben guardarse en el frontend ni en el repositorio.

Los tipos `Task`, `Event`, `RecurrenceRule`, `PersonalNote`, `Settings`, `Device` y `Notification` describen la forma de los datos que procesa el código. No reemplazan la validación del esquema de PostgreSQL.

## 3. Funciones auxiliares

### `extractProviderReason(cause)`

Intenta leer la propiedad `body` del error del proveedor. Solo analiza el cuerpo si es texto de hasta 1.500 caracteres, JSON válido y contiene un `reason` de una a 80 letras, números, guiones o guiones bajos, empezando por una letra. Si no cumple, devuelve `null`.

Esto permite obtener un código acotado del proveedor sin persistir su cuerpo de respuesta completo.

### `clockInTimezone(now, timezone)` y `quiet(now, setting)`

La primera convierte una fecha a hora local en formato de 24 horas. La segunda suprime avisos si las horas de silencio están activadas y la hora local cae dentro del intervalo configurado.

Si la zona horaria configurada no puede procesarse, se usa `America/Bogota`. La comparación contempla intervalos que cruzan la medianoche, como 22:00–07:00. Esta zona horaria solo interviene en las horas de silencio; el cálculo de recurrencias de eventos usa componentes UTC.

### `eventOccurrence(event, target)`

Determina si existe una ocurrencia del evento recurrente para el instante objetivo y devuelve su timestamp en milisegundos; si no coincide, devuelve `null`. Para eventos sin recurrencia devuelve el timestamp original.

Valida que la fecha inicial sea válida, que el intervalo sea entero entre 1 y 12, que el candidato no preceda al evento inicial y que no supere la fecha `until`, si está configurada. Evalúa estas frecuencias:

- **daily:** cada cierto número de días desde el ancla del evento.
- **weekdays:** de lunes a viernes. Aunque el intervalo se valida, esta frecuencia no lo aplica.
- **weekly:** cada cierto número de semanas, en los días configurados o, si no hay días, en el día de la semana del evento inicial.
- **monthly:** cada cierto número de meses, ajustando al último día del mes cuando el día original no existe.
- **yearly:** cada cierto número de años, ajustando al último día del mes cuando hace falta.

La fecha y hora recurrentes se calculan usando UTC. Esto debe tenerse presente al interpretar eventos alrededor de cambios de fecha o zonas horarias.

### `dueNotifications(now, tasks, events, notes, settings)`

Calcula y devuelve avisos candidatos. No realiza el envío. Para considerar un aviso “a tiempo”, el instante calculado debe haber llegado y haber transcurrido menos de cinco minutos.

#### Tareas

- Ignora tareas sin vencimiento, con fecha inválida o en estado `Finalizado`.
- Omite avisos si el propietario desactivó las alertas de tareas o está en horas de silencio.
- Elige los minutos de anticipación en este orden: excepción de la tarea, preferencia del usuario y valores por defecto `[1440, 30]`.
- Para cada intervalo, genera un candidato dentro de la ventana de cinco minutos y antes o en el vencimiento.
- También puede generar avisos de tarea vencida. Por defecto están habilitados y se repiten cada 1.440 minutos. Si el intervalo de repetición es cero, solo corresponde el aviso inicial dentro de la ventana de cinco minutos posterior al vencimiento.

El código no aplica a los intervalos de tarea la validación explícita de rango que sí aplica a los intervalos de eventos.

#### Eventos

- Solo considera eventos en estado `Programado`.
- Omite avisos si el propietario desactivó las alertas de eventos o está en horas de silencio.
- Elige los intervalos en este orden: excepción del evento, preferencia del usuario y valores por defecto `[60, 0]`.
- Acepta únicamente intervalos enteros seguros entre 0 y 525.600 minutos.
- Busca la ocurrencia que corresponde a la hora actual más el intervalo. Si cae en la ventana de cinco minutos, genera el aviso.
- Para intervalo cero usa el título “Tu evento está comenzando”; para los demás, “Evento próximo”.

#### Notas y pendientes personales

- Solo considera registros con `reminder_at`.
- Ignora fechas inválidas y pendientes (`kind === 'pending'`) ya completados.
- Omite avisos si el propietario desactivó las alertas de notas o está en horas de silencio.
- Genera el candidato cuando llega la hora programada y aún está dentro de la ventana de cinco minutos.
- Diferencia el título entre una nota y un pendiente. La clave del aviso incorpora el registro y la hora programada.

## 4. Flujo de la solicitud

1. **Valida la solicitud.** Solo acepta `POST`; otros métodos reciben HTTP 405. Comprueba que las variables requeridas existan (HTTP 503) y que el encabezado `x-orbit-scheduler-token` coincida (HTTP 401).
2. **Crea el cliente de Supabase.** Usa la clave de servicio con la persistencia de sesión desactivada.
3. **Consulta los datos en paralelo.** Carga tareas no finalizadas con vencimiento, eventos programados, notas con recordatorio, preferencias de notificación y suscripciones habilitadas. Si alguna consulta falla, responde HTTP 500 con el mensaje de error devuelto.
4. **Calcula candidatos.** Convierte las preferencias en un mapa por usuario y llama a `dueNotifications`.
5. **Procesa un diagnóstico opcional.** Si el cuerpo JSON contiene `diagnostic: true` y un `ownerId` de 36 caracteres compuesto por números hexadecimales y guiones, agrega un aviso de prueba para esa cuenta. La comprobación verifica la forma general, no todas las reglas semánticas de un UUID. El diagnóstico está protegido por la misma validación del token. Si el cuerpo está vacío o no es JSON válido, se ignora.
6. **Agrupa dispositivos por propietario.** Cada aviso se procesa únicamente contra las suscripciones habilitadas de su propietario.

## 5. Reserva, envío y reintentos

Antes de enviar, la función intenta insertar en `push_delivery_log` una fila en estado `reserved`, con un intento inicial. La lógica espera que la base de datos rechace duplicados mediante el error PostgreSQL `23505` para la combinación de propietario, dispositivo y clave de notificación. La definición de esa restricción debe verificarse en las migraciones o el esquema; este archivo no la crea.

Si aparece `23505`, consulta el registro existente. Solo vuelve a intentarlo cuando está en estado `failed`, tiene menos de tres intentos y su `next_retry_at` ya llegó. La actualización condicionada al estado y al número de intentos reduce el riesgo de que dos invocaciones reserven simultáneamente el mismo reintento. Los demás casos se cuentan como `skipped`.

El envío usa el título, el cuerpo y una etiqueta con la clave del aviso; configura un TTL de 3.600 segundos. Si el proveedor acepta el envío, el registro se actualiza a `sent` y se guarda `sent_at`. Si esa actualización falla, se registra el error en los logs de la función, pero el contador `sent` igualmente aumenta.

Cuando falla el envío:

- Incrementa `failed` y extrae el estado HTTP y el código del error, si existen.
- Usa el `reason` validado del proveedor o, si no existe, un código `HTTP_<estado>` o `NETWORK_ERROR`.
- Guarda una descripción limitada a 350 caracteres y elimina URLs. El código evita persistir el endpoint, las claves de suscripción, la clave privada y el cuerpo completo del proveedor.
- Consulta `push_error_rules` para saber si el error permite reintento o requiere una nueva suscripción.
- Si no hay una regla activa, considera reintentables los errores de red y HTTP 5xx; los errores 4xx no reconocidos no se reintentan. Por defecto, HTTP 404 y 410 requieren renovar la suscripción.
- Programa espera creciente de un minuto por intento, limitada a tres minutos, hasta un máximo de tres intentos. Si el error requiere re-suscripción o se alcanza el límite, no programa otro reintento.
- Si la suscripción fue rechazada permanentemente, deshabilita ese dispositivo.

## 6. Respuesta y lectura de los contadores

Al completar el procesamiento, responde JSON con estos campos:

| Campo | Qué cuenta |
| --- | --- |
| `checked` | Avisos candidatos, antes de multiplicarlos por la cantidad de dispositivos. |
| `sent` | Envíos que el proveedor aceptó. No confirma que el dispositivo los haya mostrado. |
| `failed` | Reservas fallidas y fallos de envío procesados. |
| `skipped` | Entregas duplicadas, reintentos todavía no elegibles o reservas concurrentes que no se pudieron tomar. |

Por eso `checked` puede ser mayor que cero aunque no haya dispositivos habilitados y los otros contadores permanezcan en cero.

## 7. Límites de esta explicación

Esta documentación describe lo comprobado en el archivo fuente. No confirma por sí sola que la función esté desplegada, que el programador la invoque correctamente, que el esquema tenga la restricción única esperada ni que una notificación haya aparecido en un dispositivo. Para verificar esos puntos se requiere revisar el despliegue, las migraciones/configuración de Cron y los registros de entrega correspondientes.
