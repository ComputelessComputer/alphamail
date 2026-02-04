-- AlphaMail Database Schema
-- Run this in your Supabase SQL Editor

-- Profiles table (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  email text not null,
  first_name text,
  last_name text,
  onboarded boolean default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Goals table
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  description text not null,
  due_date date not null,
  completed boolean default false,
  completed_at timestamptz,
  created_at timestamptz default now() not null
);

-- Emails table (tracks all communication)
create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  subject text not null,
  content text not null,
  summary text,
  mood text,
  created_at timestamptz default now() not null
);

-- Indexes
create index if not exists idx_profiles_user_id on public.profiles(user_id);
create index if not exists idx_goals_user_id on public.goals(user_id);
create index if not exists idx_goals_due_date on public.goals(due_date);
create index if not exists idx_emails_user_id on public.emails(user_id);
create index if not exists idx_emails_created_at on public.emails(created_at);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.emails enable row level security;

-- Profiles policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

-- Goals policies
create policy "Users can view own goals"
  on public.goals for select
  using (auth.uid() = user_id);

create policy "Users can insert own goals"
  on public.goals for insert
  with check (auth.uid() = user_id);

create policy "Users can update own goals"
  on public.goals for update
  using (auth.uid() = user_id);

create policy "Users can delete own goals"
  on public.goals for delete
  using (auth.uid() = user_id);

-- Emails policies
create policy "Users can view own emails"
  on public.emails for select
  using (auth.uid() = user_id);

create policy "Users can insert own emails"
  on public.emails for insert
  with check (auth.uid() = user_id);

-- Function to automatically create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create profile on signup
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function to update updated_at timestamp
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to auto-update updated_at on profiles
drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.update_updated_at_column();
