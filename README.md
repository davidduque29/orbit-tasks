# Orbit Tasks

Aplicación de proyectos, tareas, eventos y reportes con **React, TypeScript, Vite y Supabase**.

## Funcionalidades implementadas

- Registro e inicio de sesión por correo con Supabase Auth.
- Creación y eliminación de proyectos; tareas con Kanban y cambio de estado.
- Eventos y agenda almacenados en PostgreSQL.
- Métricas de cierre, porcentaje de avance y duración promedio.
- Sincronización al abrir la aplicación y después de las operaciones.
- Seguridad mediante RLS por propietario.

**Pendiente**: alarmas push, cronómetro visual, edición completa, avatar, PWA instalable y versión nativa Expo. La app en ChatGPT es un prototipo separado y no comparte automáticamente datos.

## Instalación local

Requiere Node.js 20+.

```bash
git clone https://github.com/davidduque29/orbit-tasks.git
cd orbit-tasks
npm install
cp .env.example .env
npm run dev
```

Configura la clave pública `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env` usando **Project Settings → API Keys**. No utilices claves secretas o `service_role` en el navegador.

```bash
npm run typecheck
npm test
npm run build
```

Antes de probar el registro, configura las URL de redirección y el dominio web en **Supabase → Authentication → URL Configuration**.

## Arquitectura y calidad

```text
src/
  domain/          Modelos y funciones puras (con pruebas Vitest)
  infrastructure/  Adaptador de Supabase y operaciones de persistencia
  hooks/           Obtención y actualización de datos
  components/      Pantalla de autenticación
  App.tsx          Pantallas y composición de la interfaz
```

Se usan nombres descriptivos, TypeScript estricto, lógica reutilizable y políticas RLS en siete tablas. Antes de la publicación se añadirán pruebas de integración RLS, E2E, bloqueo de versiones con package-lock y cobertura de los servicios.

## Infraestructura

Supabase project: `bwoqjsuohquqkpgssxcd` · región São Paulo (`sa-east-1`).
Tablas: `profiles`, `projects`, `tasks`, `events`, `reminders`, `device_subscriptions`, `time_entries`.

Las notificaciones con la aplicación cerrada requieren una PWA alojada en HTTPS, service worker y servidor push, o una app nativa. No están implementadas todavía.
