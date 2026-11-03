import { supabase } from './supabaseClient';
import type { OrbitEvent, Project, Task, TaskStatus } from '../domain/models';

export interface NewProject {
  name: string;
  description: string;
  color: string;
}

export interface NewTask {
  project_id: string;
  title: string;
  description: string;
  priority: Task['priority'];
  status: TaskStatus;
  estimated_due_at: string | null;
}

export interface NewEvent {
  title: string;
  description: string;
  starts_at: string;
  project_id: string | null;
}

export interface OrbitRepository {
  listProjects(): Promise<Project[]>;
  createProject(userId: string, input: NewProject): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  listTasks(): Promise<Task[]>;
  createTask(userId: string, input: NewTask): Promise<Task>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  listEvents(): Promise<OrbitEvent[]>;
  createEvent(userId: string, input: NewEvent): Promise<OrbitEvent>;
  deleteEvent(eventId: string): Promise<void>;
}

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export const orbitRepository: OrbitRepository = {
  async listProjects() {
    const { data, error } = await supabase.from('projects').select('*').order('created_at');
    throwOnError(error);
    return (data ?? []) as Project[];
  },

  async createProject(userId, input) {
    const { data, error } = await supabase
      .from('projects')
      .insert({ ...input, owner_id: userId })
      .select('*')
      .single();
    throwOnError(error);
    return data as Project;
  },

  async deleteProject(projectId) {
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    throwOnError(error);
  },

  async listTasks() {
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    throwOnError(error);
    return (data ?? []) as Task[];
  },

  async createTask(userId, input) {
    const { data, error } = await supabase
      .from('tasks')
      .insert({ ...input, owner_id: userId })
      .select('*')
      .single();
    throwOnError(error);
    return data as Task;
  },

  async updateTaskStatus(taskId, status) {
    const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId);
    throwOnError(error);
  },

  async deleteTask(taskId) {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    throwOnError(error);
  },

  async listEvents() {
    const { data, error } = await supabase.from('events').select('*').order('starts_at');
    throwOnError(error);
    return (data ?? []) as OrbitEvent[];
  },

  async createEvent(userId, input) {
    const { data, error } = await supabase
      .from('events')
      .insert({ ...input, owner_id: userId })
      .select('*')
      .single();
    throwOnError(error);
    return data as OrbitEvent;
  },

  async deleteEvent(eventId) {
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    throwOnError(error);
  },
};
