import type { Project, Task } from './models';

export interface ProgressPoint {
  date: string;
  completed: number;
  created: number;
  percent: number;
}

export interface ProjectProgressSeries {
  projectId: string;
  projectName: string;
  points: ProgressPoint[];
  created: number;
  completed: number;
  percent: number;
}

function utcDay(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/**
 * Daily reconstruction from currently available task timestamps.
 *
 * Important: this is a snapshot-based approximation, NOT an audit trail:
 * reopened/deleted/moved tasks and prior status changes cannot be reconstructed.
 */
export function buildProjectProgress(
  projects: ReadonlyArray<Pick<Project, 'id' | 'name'>>,
  tasks: ReadonlyArray<Pick<Task, 'project_id' | 'created_at' | 'completed_at' | 'status'>>,
  days: number,
  today = new Date(),
): ProjectProgressSeries[] {
  const span = Math.max(1, Math.min(365, Math.floor(days)));
  const todayDay = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dates = Array.from({ length: span }, (_, index) => {
    const day = new Date(todayDay);
    day.setUTCDate(todayDay.getUTCDate() - (span - 1 - index));
    return day.toISOString().slice(0, 10);
  });

  return projects.map(project => {
    const related = tasks.filter(task => task.project_id === project.id);
    const records = related.map(task => ({
      created: utcDay(task.created_at),
      completed: task.status === 'Finalizado' && task.completed_at ? utcDay(task.completed_at) : null,
    }));
    const points = dates.map(date => {
      const created = records.filter(record => record.created !== null && record.created <= date).length;
      const completed = records.filter(record =>
        record.created !== null && record.created <= date
        && record.completed !== null && record.completed <= date,
      ).length;
      return {
        date,
        created,
        completed,
        percent: created > 0 ? Math.round((completed / created) * 100) : 0,
      };
    });
    const last = points[points.length - 1];
    return {
      projectId: project.id,
      projectName: project.name,
      points,
      created: last.created,
      completed: last.completed,
      percent: last.percent,
    };
  });
}

export function combinedProgress(series: ReadonlyArray<ProjectProgressSeries>): ProgressPoint[] {
  if (!series.length) return [];
  return series[0].points.map((point, index) => {
    const created = series.reduce((total, item) => total + item.points[index].created, 0);
    const completed = series.reduce((total, item) => total + item.points[index].completed, 0);
    return {
      date: point.date,
      created,
      completed,
      percent: created ? Math.round(100 * completed / created) : 0,
    };
  });
}
