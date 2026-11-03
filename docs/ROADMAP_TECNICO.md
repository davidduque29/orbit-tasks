# Orbit Tasks — Roadmap técnico y bitácora reutilizable

**Proyecto de referencia:** https://github.com/davidduque29/orbit-tasks  
**PWA:** https://davidduque29.github.io/orbit-tasks/  
**Tecnología:** React, TypeScript, Vite, Supabase (Auth, PostgreSQL, RLS, Edge Functions), GitHub Actions y GitHub Pages.  
**Fecha de corte:** 3 de noviembre de 2026.  
**Propósito:** documentar decisiones, ejecución, errores, controles de seguridad, validaciones y pasos replicables al desarrollar otra aplicación.

> Estados: ✅ implementado/validado en la fase indicada · 🟡 parcial o pendiente de prueba funcional · ⬜ pendiente. El éxito de CI no prueba la entrega push en un móvil.

## Fase 0 — Requisitos, arquitectura y modelo ✅

- Identificar entidades: usuarios/perfiles, proyectos, tareas, eventos, recordatorios, suscripciones push y entradas de tiempo.
- Separar frontend (React + TypeScript), acceso a datos (repositorio de Supabase), dominio y pruebas.
- Principios solicitados: SOLID, KISS, DRY, nombres expresivos, indentación y pruebas unitarias.
- Estrategia: un único repositorio y backend compartido para web, PWA y posible app nativa futura.
- Pendiente para una segunda iteración: documentar explícitamente casos de uso, diagramas C4 y modelo ER completo.

## Fase 1 — Repositorio, CI/CD y hosting ✅

1. Crear repositorio GitHub `davidduque29/orbit-tasks`.
2. Configurar Vite, TypeScript y scripts de `npm test`, `npm run typecheck` y `npm run build`.
3. Configurar GitHub Actions (CI y despliegue).
4. Activar GitHub Pages como hosting del frontend estático; Supabase aloja datos, autenticación y lógica de servidor.
5. Corregir error de incompatibilidad de tipos asociado a `defineConfig` en `vite.config.ts` y el uso de configuraciones de Vitest/Vite.
6. Verificar ambas ejecuciones verdes antes de cerrar un cambio.

**Lecciones:** no publicar cambios intermedios directamente a `main` cuando se pueda trabajar con ramas/PR; ejecutar tests y typecheck antes de desplegar; conservar secretos fuera del repositorio.

## Fase 2 — Supabase, autenticación y seguridad ✅ / 🟡

- Crear proyecto Supabase y tablas, conectar frontend con URL y clave **publishable**.
- Configurar Supabase Auth (registro, confirmación, inicio de sesión, cerrar sesión, recuperación de contraseña).
- Corregir redirección incorrecta hacia `localhost:3000` usando la URL de producción en Auth → URL Configuration.
- Añadir ver contraseña, confirmación y validaciones en frontend. **No afirmar** que ello equivale a políticas servidor de historial/no reutilización o detección exhaustiva de contraseñas filtradas.
- Usar RLS por `auth.uid()` en tablas que contienen datos por usuario; verificar políticas individualmente.
- Gestión de perfiles y nombre visible, avatar de iniciales.
- 🟡 Auditoría completa de RLS, roles, auth y controles backend; política de contraseñas comprometidas si la función de Supabase está disponible.

## Fase 3 — Proyectos, tareas, eventos y reportes ✅

- CRUD básico y relaciones entre proyectos y tareas.
- Tarjetas de proyectos: total, pendientes, finalizadas, barra de avance.
- Tablero: Kanban y lista colapsable, expansión individual/global, búsqueda por palabra clave, filtros por proyecto/estado/prioridad/fecha.
- Estados visibles: Activa (amarillo), En progreso (naranja), Impedimento (rojo), Finalizado (verde).
- **Compatibilidad histórica**: algunos valores de estado almacenados siguen como `Por hacer` / `En revisión` y se presentan como Activa / Impedimento. 🟡 Migración definitiva pendiente.
- Campo de resolución para impedimento/finalización; fecha de cierre registrada.
- Eventos, agenda y métricas básicas.
- 🟡 Pendiente: historial inmutable de transiciones/resoluciones y edición completa de todos los registros.

## Fase 4 — PWA e interfaz móvil ✅

- `manifest.webmanifest`, iconos 192/512, metadatos para iOS y Service Worker.
- Deploy bajo ruta `/orbit-tasks/`; abrir desde icono de pantalla de inicio.
- Caché solo del shell/archivos estáticos; no almacenar respuestas privadas de Supabase.
- Ajustar navegación en iPhone para mostrar Inicio, Proyectos, Tablero, Eventos, Reportes, Avisos en dos filas y evitar desbordamiento horizontal.
- Probar inicio de sesión, navegación, nombre visible, tareas y eventos desde el dispositivo.
- 🟡 La PWA no implica almacenamiento de datos de usuario disponible sin conexión ni sincronización offline automática.

## Fase 5 — Preferencias de notificaciones ✅

- Pantalla **Avisos / Centro de notificaciones**.
- `notification_preferences`: avisos anticipados de tareas, frecuencias de tareas vencidas, avisos de eventos al inicio y con anticipación, horario de silencio, zona horaria.
- Campos `reminder_override_minutes` en tareas/eventos para sobrescribir configuración por registro.
- Intervalos predefinidos y personalizados; guardado por usuario con RLS.
- Pruebas unitarias de normalización/validación de intervalos.
- Corrección de tests: aislar/mockear dependencias de Supabase en tests de lógica pura.

## Fase 6 — Entrega de Web Push 🟡

**Completado parcialmente:**
- Service Worker escucha eventos `push` y abre Orbit Tasks al tocar una notificación.
- Interfaz para solicitar permisos y registrar/desactivar cada dispositivo.
- Tabla `device_subscriptions` para las suscripciones por usuario; tabla `push_delivery_log` para intentos y deduplicación.
- Edge Function `send-push` desplegada en Supabase; lógica de avisos de tareas/eventos y deduplicación por dispositivo.
- Extensiones `pg_cron` (esquema `pg_catalog`) y `pg_net` (esquema `extensions`) habilitadas y comprobadas.

**Pendiente antes de declarar funcional:**
1. Generar un par válido VAPID con `npx --yes web-push generate-vapid-keys` desde un equipo de confianza.
2. Configurar las variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `PUSH_SCHEDULER_TOKEN` como secretos en Supabase. Nunca copiar aquí ni a GitHub la clave privada o token.
3. Verificar que la clave pública usada al hacer `pushManager.subscribe` en frontend sea **exactamente** la que pertenece a la privada del servidor. Actualizar la configuración de la compilación si es necesario.
4. Revisar la seguridad de invocación de `send-push`: actualmente la función tiene `verify_jwt=true`, además de validar su token de programación. El scheduler debe satisfacer **ambos** controles, o rediseñarse la autenticación sin quedar públicamente invocable.
5. Programar con `pg_cron` + `pg_net` una llamada periódica a la Edge Function; guardar credenciales del job mediante Vault. Evitar secretos literales en SQL versionado.
6. Abrir la **PWA instalada** en iPhone, pulsar Activar notificaciones y verificar que se creó una suscripción válida en Supabase.
7. Crear un evento 10 min en el futuro con aviso 5 min antes y comprobar aviso con la PWA cerrada.
8. Repetir prueba en Android; verificar permisos, horario de silencio, cambios de fecha, tareas finalizadas, suscripciones caducadas y no duplicación.
9. Revisar logs de función, `push_delivery_log`, y adaptar reintentos seguros. Evitar prometer entrega exacta al minuto (depende de sistema y servicios push).

> **Advertencia de implementación:** un par VAPID no coincidente produce suscripciones que no pueden utilizarse correctamente; no basta con ver verde CI y deploy. Las reglas de repetición de tareas vencidas deben probarse para no saturar de avisos. Los secretos deben añadirse en el dashboard oficial de Supabase.

## Fase 7 — Calidad y seguridad antes de producción ⬜ / 🟡

- Tests unitarios y de integración adicionales; smoke test web; pruebas de flujos críticos en iPhone y Android.
- Comprobar 401/403, RLS, IDOR, rate limit, límites de recursos y tratamiento de datos personales.
- Validación de errores de Supabase/Edge Functions, auditoría OWASP, permisos mínimos, rotación de secretos.
- Observabilidad de notificaciones: historial de envíos y fallos; métricas básicas.
- Migrar cambios vía ramas, PRs, revisión automática y despliegue protegido.

## Fase 8 — Evolución ⬜

- Mejoras de reportes, notificaciones y experiencia.
- Opcional: Capacitor para apps nativas iOS/Android manteniendo el mismo código y Supabase; separar adaptadores Web Push/APNs/FCM si se decide.
- Respaldos y estrategia de recuperación documentada; manual de usuario y operación.

## Plantilla para replicar otra aplicación

Para cada fase documentar: **objetivo → arquitectura → herramientas/versiones → prerequisitos → comandos y pasos → secretos requeridos (solo nombres) → cambios de DB → pruebas → evidencia → errores encontrados → solución → rollback → estado actual**.

### Referencias

- Supabase: https://supabase.com/docs
- Programar Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Web Push: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- GitHub Actions: https://docs.github.com/en/actions
