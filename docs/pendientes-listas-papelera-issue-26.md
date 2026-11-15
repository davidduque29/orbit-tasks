# Pendientes: listas automáticas y papelera (#26)

Estado: implementación parcial; **no desplegado**.

## Implementado en esta rama
- `src/domain/pendingChecklist.ts`: detección de al menos dos elementos separados por comas, limpieza de espacios y descarte de vacíos.
- `src/domain/pendingChecklist.test.ts`: pruebas Vitest del parser.

## Integración pendiente
1. Revisar esquema Supabase real, triggers de recurrencia, RLS y relaciones antes de migrar.
2. Crear tabla de elementos `note_items` con referencia a `notes`, posición, estado, owner/RLS y borrado coherente.
3. Añadir ayuda contextual y vista previa en captura rápida y editor. Preservar texto original; definir título de lista sin inferencias destructivas.
4. Tarjeta compacta colapsada por defecto: botón con icono de lista, texto «Ver lista» y chevron abajo; expandida «Ocultar» y chevron arriba; contador y barra de progreso.
5. Implementar soft-delete de ocurrencia/serie, papelera, restauración, eliminación definitiva confirmada y purga a 30 días.
6. Asegurar que recurrencias y push excluyan eliminados; prevenir duplicados de ocurrencias.
7. Corregir teclado móvil, botón Guardar y alineación; mantener «Configurar recordatorio».
8. Validar Vitest, typecheck, build, RLS, pruebas E2E iPhone/Android y GitHub Pages.

## Riesgos
- La implementación actual usa `delete()` físico en `NotesBoard.tsx`; **no cambiarla** sin migración previa.
- La longitud de título actual es 80 caracteres: no truncar listas largas silenciosamente.
- No asumir que pendientes previamente borrados pueden restaurarse.
- Evitar desplegar código dependiente de migraciones hasta confirmar su aplicación.

## Criterio de salida
PR revisado, migraciones aplicadas, pruebas aprobadas y despliegue GitHub Pages confirmado.