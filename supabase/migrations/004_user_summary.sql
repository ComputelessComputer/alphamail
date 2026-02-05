-- Add AI-generated summary field to profiles
-- This gets updated after each conversation with Alpha

alter table public.profiles 
add column if not exists summary text;

-- Add a comment explaining the field
comment on column public.profiles.summary is 'AI-generated summary of user journey, updated after each conversation';
