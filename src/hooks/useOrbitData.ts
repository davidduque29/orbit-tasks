import { useCallback, useEffect, useState } from 'react';
import type { OrbitEvent, Project, Task } from '../domain/models';
import { orbitRepository } from '../infrastructure/orbitRepository';

export interface OrbitData {
  projects: Project[];
  tasks: Task[];
  events: OrbitEvent[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

export function useOrbitData(userId: string | undefined): OrbitData {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<OrbitEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      const [nextProjects, nextTasks, nextEvents] = await Promise.all([
        orbitRepository.listProjects(),
        orbitRepository.listTasks(),
        orbitRepository.listEvents(),
      ]);

      setProjects(nextProjects);
      setTasks(nextTasks);
      setEvents(nextEvents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, tasks, events, loading, error, refresh };
}
