# Migración aplicada en Supabase — 2026-11-14

Proyecto: `bwoqjsuohquqkpgssxcd`

Migración remota aplicada: `pending_checklists_and_soft_delete`.

## Cambios
- `notes.deleted_at timestamptz` nullable, con índice `notes_owner_deleted_idx`.
- Tabla `note_items`: `id`, `note_id`, `owner_id`, `content`, `position`, `completed`, `created_at`, `updated_at`.
- Índice `note_items_note_position_idx`; borrado en cascada al eliminar una nota definitivamente.
- RLS habilitado y políticas SELECT/INSERT/UPDATE/DELETE por propietario; insert/update/delete verifican nota activa.

## Verificación
Consulta posterior confirmó `notes.deleted_at`, tabla `note_items` y RLS habilitado.

## Precauciones antes de desplegar
- Frontend actual todavía no persiste `note_items` ni implementa restauración/purga.
- Revisar funciones de recurrencia y push para excluir `deleted_at is not null`.
- Implementar y probar la UI y las políticas con sesiones reales antes de fusionar.
