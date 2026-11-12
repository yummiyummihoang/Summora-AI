# Summora AI

Summora imports documents, validates prompt/model settings, and runs Vietnamese summaries. On this branch, Next.js handles the UI and API, Supabase provides Auth/Postgres/private Storage, and Vercel Workflow runs durable background jobs. The older Python service files remain in the repository but are not part of this Vercel deployment.

## Stack

- Next.js 16, React 19, TypeScript and Tailwind CSS in `apps/web`.
- Supabase Auth and PostgreSQL, accessed by the server through Prisma.
- Vercel Workflow SDK for durable job processing. Workflow events carry only a job ID; documents and progress stay in Postgres.
- Supabase private Storage for completed JSON files and short-lived signed downloads.

## Deploy to Vercel

Create a Vercel project from this repository and set **Root Directory** to `apps/web`. Keep the install and build commands from `apps/web/vercel.json`; they install the pnpm monorepo, generate Prisma Client, and build the Next.js app. Use Node.js 22.12 or newer.

Set these environment variables for Production and Preview as needed:

| Variable                                                                     | Purpose                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                   | Supabase project URL                                                                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                       | Supabase browser/Auth key                                                                                |
| `SUPABASE_SERVICE_ROLE_KEY`                                                  | Server-only private Storage uploads, deletes and signed URLs                                             |
| `DATABASE_URL`                                                               | Supabase Postgres runtime connection string; use the transaction pooler with `?pgbouncer=true` if needed |
| `DIRECT_URL`                                                                 | Direct/session Postgres connection for Prisma migrations                                                 |
| `STUDIO_RESULTS_BUCKET`                                                      | Private bucket name; defaults to `summora-results`                                                       |
| `CRON_SECRET`                                                                | Long random secret protecting the retention cron                                                         |
| `STUDIO_RETENTION_DAYS`                                                      | Completed job/draft retention; defaults to 30 days                                                       |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | Optional server-only provider credentials                                                                |
| `OPENAI_MODELS`, `DEEPSEEK_MODELS`, `OPENROUTER_MODELS`, `GEMINI_MODELS`     | Comma-separated model IDs enabled for the matching provider                                              |

Never expose provider credentials, database URLs, or the Supabase service role key through a `NEXT_PUBLIC_` variable. For a Supabase project in Mumbai, `apps/web/vercel.json` places server functions in Vercel's `bom1` region to keep database and storage requests nearby. Change that region if the database is elsewhere.

Before the first deployment, apply migrations once from a trusted machine with the database connection configured:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate
```

The Vercel build does not run database migrations. Vercel Workflow is enabled by `withWorkflow` in `apps/web/next.config.ts`; its generated handlers are excluded from the auth proxy. The daily cron removes expired job payloads and result files. Vercel Workflows setup details: <https://workflow-sdk.dev/worlds/vercel>.

## Run locally

Create `apps/web/.env.local` using `apps/web/.env.local.example`, then configure Supabase Auth, the same Postgres database, a private `summora-results` Storage bucket, and at least one provider/model pair.

```powershell
corepack pnpm install
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm dev
```

Open <http://localhost:3000>. Workflow SDK uses its local world during development; no separate API or worker process is needed for this branch. If Storage service credentials are not configured locally, completed results are returned from the job state for direct download.

## Data and security

- Supabase Auth owns user identity; API handlers enforce job ownership and same-origin writes.
- Postgres stores drafts, private prompts, job state, quotas, idempotency keys and rate limits.
- Provider keys are read only by server functions and are never returned to the browser.
- Result objects live in a private Supabase Storage bucket; downloads use five-minute signed URLs.
- Workflow steps check cancellation between provider calls, persist each result, and charge task quota once per saved result.
- The Vercel cron requires `CRON_SECRET` and prunes completed jobs and drafts after the configured retention period.
