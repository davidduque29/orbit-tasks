import type { Task } from './models';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function calculateCycleDays(task: Pick<Task, 'created_at' | 'completed_at'>): number | null {
  if (!task.completed_at) return null;

  const elapsed = Date.parse(task.completed_at) - Date.parse(task.created_at);
  return Number.isFinite(elapsed) && elapsed >= 0
    ? elapsed / MILLISECONDS_PER_DAY
    : null;
}

export function calculateCompletionRate(
  tasks: ReadonlyArray<Pick<Task, 'status'>>,
): number {
  if (tasks.length === 0) return 0;
  return (tasks.filter((task) => task.status === 'Finalizado').length / tasks.length) * 100;
}

export function calculateAverageCycleDays(
  tasks: ReadonlyArray<Pick<Task, 'created_at' | 'completed_at'>>,
): number | null {
  const completedCycles = tasks
    .map(calculateCycleDays)
    .filter((days): days is number => days !== null);

  if (completedCycles.length === 0) return null;
  return completedCycles.reduce((total, days) => total + days, 0) / completedCycles.length;
}

export function countClosuresByDay(
  tasks: ReadonlyArray<Pick<Task, 'completed_at'>>,
  startDate: Date,
  days: number,
): Array<{ date: string; count: number }> {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    const dateKey = date.toISOString().slice(0, 10);

    return {
      date: dateKey,
      count: tasks.filter((task) => task.completed_at?.slice(0, 10) === dateKey).length,
    };
  });
}
