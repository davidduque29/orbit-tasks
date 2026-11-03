export const TASK_STATUSES = [
  'Por hacer',
  'En progreso',
  'En revisión',
  'Finalizado',
] as const;

export const TASK_PRIORITIES = ['Baja', 'Media', 'Alta', 'Crítica'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  color: string;
  status: 'Activo' | 'Pausado' | 'Archivado';
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  owner_id: string;
  project_id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  estimated_due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  effort_points: number | null;
  resolution: string;
  reminder_override_minutes: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface OrbitEvent {
  id: string;
  owner_id: string;
  project_id: string | null;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  reminder_override_minutes: number[] | null;
  status: 'Programado' | 'Completado' | 'Cancelado';
  created_at: string;
  updated_at: string;
}

export interface Profile {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
  timezone: string;
}
