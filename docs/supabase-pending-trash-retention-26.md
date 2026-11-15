# Papelera y recurrencia — migración aplicada

Proyecto Supabase: `bwoqjsuohquqkpgssxcd`

Migración: `pending_trash_retention_and_recurrence` (2026-11-14).

- La función `orbit_internal.advance_recurring_items()` ignora notas con `deleted_at` no nulo.
- Las nuevas ocurrencias copian sus `note_items` con `completed=false`.
- Se mantiene el procesamiento de eventos sin cambios de comportamiento.
- Trabajo pg_cron `orbit-purge-trashed-notes` a las 03:17 UTC cada día, que elimina notas en papelera desde hace más de 30 días.
- La purga hace cascada a `note_items`.

## Pendientes de verificación
- Verificar que la Edge Function de push ignore notas eliminadas.
- Pruebas integradas de creación, recuperación, recurrencia y purga con usuario autenticado.
- UX de móviles, accesibilidad y revisión de estilo.
