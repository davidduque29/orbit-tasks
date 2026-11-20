-- Project and event recycle bins. Existing records remain active (NULL).
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.events add column if not exists deleted_at timestamptz;
create index if not exists idx_orbit_projects_owner_deleted_at on public.projects (owner_id, deleted_at);
create index if not exists idx_orbit_events_owner_deleted_at on public.events (owner_id, deleted_at);
