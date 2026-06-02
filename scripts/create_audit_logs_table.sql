-- Create audit_logs table for centralized activity and audit tracking.
-- Run this script in Supabase SQL editor or through your database migration tool.

create extension if not exists "pgcrypto";

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  action text not null,
  resource_id text,
  resource_type text not null,
  performed_by_id uuid,
  performed_by_name text,
  performed_at timestamptz not null default now(),
  description text not null,
  changes jsonb,
  created_at timestamptz not null default now()
);

-- If you are using RLS, add policies for authenticated users.
-- create policy "Allow authenticated select" on public.audit_logs
--   for select using (auth.role() = 'authenticated');
-- create policy "Allow authenticated insert" on public.audit_logs
--   for insert with check (auth.role() = 'authenticated');
