import { describe, expect, it } from 'vitest';
import { buildProjectProgress, combinedProgress } from './projectProgress';

const projects = [
  { id: 'a', name: 'Proyecto A' },
  { id: 'b', name: 'Proyecto B' },
];
const tasks = [
  { project_id: 'a', created_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-03T10:00:00Z', status: 'Finalizado' as const },
  { project_id: 'a', created_at: '2026-11-02T10:00:00Z', completed_at: null, status: 'En progreso' as const },
  { project_id: 'b', created_at: '2026-11-02T10:00:00Z', completed_at: '2026-11-04T10:00:00Z', status: 'Finalizado' as const },
];

describe('project progress reconstruction', () => {
  it('reports daily historical percentages per project from creation and closure dates', () => {
    const result = buildProjectProgress(projects, tasks, 4, new Date('2026-11-04T12:00:00Z'));
    expect(result[0].points.map(point => point.percent)).toEqual([0, 0, 50, 50]);
    expect(result[1].points.map(point => point.percent)).toEqual([0, 0, 0, 100]);
  });

  it('combines project counts before calculating aggregate percentage', () => {
    const result = combinedProgress(buildProjectProgress(projects, tasks, 4, new Date('2026-11-04T12:00:00Z')));
    expect(result[result.length - 1]).toMatchObject({ created: 3, completed: 2, percent: 67 });
  });

  it('shows zero for projects with no tasks instead of imaginary history', () => {
    const result = buildProjectProgress([{ id: 'empty', name: 'Vacío' }], tasks, 7, new Date('2026-11-04T12:00:00Z'));
    expect(result[0].points.every(point => point.percent === 0 && point.created === 0)).toBe(true);
  });
});
