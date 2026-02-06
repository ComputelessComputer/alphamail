# Agents

## Setup
- use pnpm
- node 18+
- `pnpm dev` to run locally, `pnpm build` to build

## Stack
- astro (SSG + server endpoints on vercel)
- tailwind css v4
- supabase (auth + postgres)
- resend (email)
- anthropic claude (AI)
- upstash redis (rate limiting)

## Conventions
- all user-facing copy is lowercase, no emojis, no em-dashes (use -- instead)
- API routes go in `src/pages/api/`
- AI functions go in `src/lib/ai.ts` with retry logic via `withRetry()`
- server-side endpoints use `createServerClient()` (service role, bypasses RLS)
- client-side code uses `supabase` export (anon key, respects RLS)
- security utilities (rate limiting, CSRF, webhook verification) are in `src/lib/security.ts`
- email utilities (send, wrap HTML/text, escape) are in `src/lib/resend.ts`
- database migrations are in `supabase/migrations/` numbered sequentially (001, 002, etc.)
- always escape user content with `escapeHtml()` before inserting into email HTML
- always escape LIKE patterns with `escapeLikePattern()` before using in queries
- error messages shown to users should be generic (no internal details)
- all AI calls should handle `AIFailureError` and send fallback emails when AI is down

## Before pushing
- run `pnpm build` to verify no build errors
- no lint or format tooling is set up yet -- just make sure the build passes

## Deploy
- vercel (main branch auto-deploys)
- env vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `PUBLIC_APP_URL`
- sunday check-in cron: `0 14 * * 0` hitting `/api/email/checkin`
