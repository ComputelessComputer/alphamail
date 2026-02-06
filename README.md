# AlphaMail

An open-source, AI-powered weekly accountability partner that lives entirely in your inbox. No app, no dashboard -- just email.

**[bealphamail.com](https://bealphamail.com)**

## How It Works

1. **Sign up** -- enter your email on the website or email alpha@bealphamail.com directly
2. **Confirm** -- click the magic link Alpha sends to prove you're real
3. **Conversational onboarding** -- Alpha emails you asking for your name and first goal, and chats naturally across as many replies as needed
3. **Sunday check-in** -- every Sunday, Alpha emails asking how your goal went
4. **Reply** -- tell Alpha what happened, set your next goal
5. **Repeat** -- Alpha remembers your full conversation history and keeps you accountable

## Features

- **AI-powered conversations** -- Alpha responds personally using your full conversation history
- **Email-first** -- everything happens in your inbox, zero apps
- **Conversational onboarding** -- no rigid forms; Alpha naturally collects your info through back-and-forth email
- **Multiple entry points** -- sign up from the website, or just email alpha@bealphamail.com
- **Group accountability** -- CC a friend to create accountability pairs
- **Conversation threading** -- replies stay in the same email thread
- **Journey summary** -- AI-generated summary of your progress on your account page
- **Security hardened** -- webhook signature verification, rate limiting, CSRF protection, CSP headers
- **Bounce/complaint tracking** -- automatically stops emailing invalid addresses

## Tech Stack

- **Framework**: [Astro](https://astro.build) with TypeScript
- **Styling**: [Tailwind CSS](https://tailwindcss.com)
- **Auth & Database**: [Supabase](https://supabase.com)
- **Email**: [Resend](https://resend.com)
- **AI**: [Anthropic Claude](https://anthropic.com)
- **Rate Limiting**: [Upstash Redis](https://upstash.com) (optional)
- **Deployment**: [Vercel](https://vercel.com)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- Supabase account
- Resend account (with a domain verified)
- Anthropic API key

### 1. Clone and install

```bash
git clone https://github.com/ComputelessComputer/alphamail.git
cd alphamail
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in your `.env`:

```
# Supabase
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# API Keys
RESEND_API_KEY=re_xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx

# App
PUBLIC_APP_URL=http://localhost:4321
CRON_SECRET=any-random-string

# Security (optional but recommended for production)
RESEND_WEBHOOK_SECRET_INBOUND=whsec_xxxxx   # From inbound webhook settings
RESEND_WEBHOOK_SECRET_EVENTS=whsec_xxxxx    # From events webhook settings
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io  # For rate limiting
UPSTASH_REDIS_REST_TOKEN=xxxxx
CSRF_SECRET=any-random-string  # Auto-generated if not set
```

### 3. Set up Supabase

Run all migrations in order in the Supabase SQL Editor:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_email_threads.sql
supabase/migrations/003_pending_emails_and_groups.sql
supabase/migrations/004_user_summary.sql
supabase/migrations/005_email_bounce_tracking.sql
supabase/migrations/006_pending_emails_rls.sql
```

Configure Supabase Auth:
- **Site URL**: `https://yourdomain.com`
- **Redirect URLs**: `https://yourdomain.com/onboarding`
- Set up custom SMTP with Resend for magic link emails

### 4. Set up Resend

1. Verify your domain in Resend
2. Create two webhooks:
   - `https://yourdomain.com/api/email/inbound` → Event: `email.received`
   - `https://yourdomain.com/api/webhook/resend-events` → Events: `email.bounced`, `email.complained`
3. Copy each webhook's signing secret:
   - Inbound webhook secret → `RESEND_WEBHOOK_SECRET_INBOUND`
   - Events webhook secret → `RESEND_WEBHOOK_SECRET_EVENTS`
4. Set up inbound email address (e.g., `alpha@yourdomain.com`)

### 5. Set up Upstash (optional, for rate limiting)

1. Create a Redis database at [upstash.com](https://upstash.com)
2. Copy the REST URL and token to your `.env`

### 6. Run locally

```bash
pnpm dev
```

Open [http://localhost:4321](http://localhost:4321)

## Deployment

### Vercel

1. Connect your repo to Vercel
2. Add all environment variables
3. Deploy

### Cron Job

The Sunday check-in is triggered by a cron job. Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/email/checkin",
      "schedule": "0 14 * * 0"
    }
  ]
}
```

This runs every Sunday at 2pm UTC.

## Project Structure

```
src/
├── lib/
│   ├── ai.ts           # Anthropic Claude integration (all AI functions)
│   ├── resend.ts       # Email sending utilities
│   ├── security.ts     # Security utilities (rate limit, CSRF, etc.)
│   └── supabase.ts     # Supabase client
├── middleware.ts       # Security headers (CSP)
├── pages/
│   ├── api/
│   │   ├── email/
│   │   │   ├── checkin.ts    # Sunday cron endpoint
│   │   │   ├── inbound.ts    # Resend inbound webhook (all reply handling)
│   │   │   ├── onboarding.ts # Sends Alpha's intro email
│   │   │   └── welcome.ts    # Welcome email after onboarding
│   │   ├── user/
│   │   │   ├── delete-account.ts
│   │   │   ├── link-pending-emails.ts
│   │   │   ├── signup.ts     # Website signup (AI parses free-form message)
│   │   │   └── update-summary.ts
│   │   └── webhook/
│   │       └── resend-events.ts  # Bounce/complaint handling
│   ├── account.astro
│   ├── billing.astro
│   ├── index.astro        # Landing page (product preview)
│   ├── onboarding.astro
│   ├── signin.astro
│   └── signup.astro       # Compose email signup form
└── layouts/
    └── BaseLayout.astro

supabase/
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_email_threads.sql
    ├── 003_pending_emails_and_groups.sql
    ├── 004_user_summary.sql
    ├── 005_email_bounce_tracking.sql
    └── 006_pending_emails_rls.sql
```

## Database Schema

- **profiles** — User profiles with email, name, onboarded status, AI summary
- **goals** — Weekly goals with completion tracking
- **emails** — All email conversations with threading
- **pending_emails** — Emails from non-authenticated users (linked after signup)
- **groups** — Accountability groups
- **group_members** — Group membership
- **group_goals** — Shared goals for groups

## How the AI Works

1. **onboardingConversation** -- natural multi-turn conversation to collect name + goal from new users, with full conversation history
2. **parseOnboardingReply** -- single-shot extraction of name + goal from free-form text (used by website signup)
3. **parseUserReply** -- extracts progress, completion status, mood, and next goal from check-in replies
4. **generateAlphaResponse** -- creates personalized response to check-in replies based on conversation history
5. **generateConversation** -- handles open-ended conversations when no active goal exists
6. **generateUserSummary** -- creates journey summary for account page

All AI calls include retry logic (3 attempts with exponential backoff) and fallback emails if AI fails.

## User Flows

**Website signup**: Landing page (`/`) shows a preview of Alpha's Sunday check-in email. Click "Start your first goal" to go to `/signup`, where you write Alpha a free-form email with your name and goal. AI parses it server-side, creates your account, and sends a welcome email.

**Email-first**: Email alpha@bealphamail.com directly. Alpha replies with an intro and a signup link. Once signed up, Alpha chats naturally over email to learn your name and goal -- no rigid forms, just conversation across as many replies as needed.

**CC a friend**: CC alpha@bealphamail.com on an email with a friend to start group accountability.

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss what you'd like to change.

---

Built by [ComputelessComputer](https://github.com/ComputelessComputer)
