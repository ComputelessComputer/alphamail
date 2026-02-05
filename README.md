# AlphaMail ✉️

An AI-powered weekly accountability partner that lives in your inbox. No app, no complicated system — just email.

**[bealphamail.com](https://bealphamail.com)**

## How It Works

1. **Sign up** with your email
2. **Set a goal** for the week
3. **Sunday check-in** — Alpha emails you asking how it went
4. **Reply** with your progress and next goal
5. **Repeat** — Alpha remembers your conversations and keeps you accountable

## Features

- 🤖 **AI-powered conversations** — Alpha responds personally based on your history
- 📧 **Email-first** — Everything happens in your inbox, no app needed
- 👥 **Group accountability** — CC a friend to create accountability pairs
- 🔄 **Conversation threading** — Replies stay in the same email thread
- 📊 **Journey summary** — AI-generated summary of your progress on your account page
- 🔒 **Magic link auth** — No passwords, just click a link
- 🛡️ **Security hardened** — Webhook verification, rate limiting, CSRF protection, CSP headers

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
│   ├── ai.ts           # Anthropic Claude integration
│   ├── resend.ts       # Email sending utilities
│   ├── security.ts     # Security utilities (rate limit, CSRF, etc.)
│   └── supabase.ts     # Supabase client
├── middleware.ts       # Security headers (CSP)
├── pages/
│   ├── api/
│   │   ├── email/
│   │   │   ├── checkin.ts    # Sunday cron endpoint
│   │   │   ├── inbound.ts    # Resend webhook for replies
│   │   │   └── welcome.ts    # Welcome email
│   │   ├── user/
│   │   │   ├── delete-account.ts
│   │   │   ├── link-pending-emails.ts
│   │   │   └── update-summary.ts
│   │   └── webhook/
│   │       └── resend-events.ts  # Bounce handling
│   ├── account.astro
│   ├── billing.astro
│   ├── index.astro
│   ├── onboarding.astro
│   ├── signin.astro
│   └── signup.astro
└── layouts/
    └── BaseLayout.astro

supabase/
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_email_threads.sql
    ├── 003_pending_emails_and_groups.sql
    ├── 004_user_summary.sql
    └── 005_email_bounce_tracking.sql
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

1. **parseUserReply** — Extracts progress, completion status, mood, and next goal from user's email
2. **generateAlphaResponse** — Creates personalized response based on context
3. **generateConversation** — Handles open-ended conversations
4. **generateUserSummary** — Creates journey summary for account page

All AI calls include retry logic (3 attempts with exponential backoff) and fallback emails if AI fails.

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss what you'd like to change.

---

Built with ❤️ by [ComputelessComputer](https://github.com/ComputelessComputer)
