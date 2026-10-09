# Supabase storage

The booking API stores appointments in Supabase. When
`SUPABASE_SERVICE_ROLE_KEY` is configured, sign-up accounts and password-reset
codes are stored there too. Without that key, local development uses
`faizii1.json`; Vercel does not use that file for account persistence.

## Create the table

In the Supabase SQL editor, run:

```sql
create table if not exists public.appointments (
    id uuid primary key,
    user_id uuid not null,
    name text not null,
    phone text not null,
    email text not null,
    service text not null,
    price integer not null,
    date date not null,
    time time not null,
    created_at timestamptz not null,
    updated_at timestamptz
);

create table if not exists public.app_users (
    id uuid primary key,
    name text not null,
    email text not null unique,
    password_hash text not null,
    role text not null check (role in ('user', 'admin')),
    created_at timestamptz not null
);

create table if not exists public.password_resets (
    email text primary key references public.app_users(email) on delete cascade,
    code_hash text not null,
    attempts integer not null default 0,
    expires_at timestamptz not null
);

alter table public.appointments enable row level security;
alter table public.app_users enable row level security;
alter table public.password_resets enable row level security;

revoke all on public.appointments, public.app_users, public.password_resets from public, anon, authenticated;
grant select, insert, update, delete on public.appointments, public.app_users, public.password_resets to service_role;
```

The server verifies the signed-in user and applies the existing admin/owner
access rules before using the Supabase service-role key. Do not add the key to
frontend code or commit it. Keep the table inaccessible to `anon` and
`authenticated` roles unless a separate, reviewed access policy is required.

## Configure local development

Use Node.js 18 or newer, which provides the server-side `fetch` API used for
Supabase requests. Copy `faizii1.env` to `faizii1.env.local` and set the
Supabase service-role key there. The JSON file is only a local-development
fallback and must not be used as production storage.

## Configure Vercel

Use the repository root as the Vercel project root, the Express framework
preset, and the `master` production branch. Leave the build command and output
directory unset; the Express function serves the API and Vercel serves files
from `public/`.

In Vercel Project Settings → Environment Variables, set:

- `SUPABASE_REST_URL`: your Supabase project's `/rest/v1` URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the private service-role key. Never expose it in
  frontend code or commit it.
- `JWT_SECRET`: a private random value at least 32 characters long.
- `ADMIN_EMAIL`: the email that should receive the admin role on signup.
- `EMAIL_USER` and `EMAIL_PASS`: SMTP credentials, if booking confirmations and
  password recovery emails are required.

Apply the SQL above in the Supabase SQL editor before deploying. Redeploy after
setting environment variables. If an environment variable or Supabase table is
missing, affected API requests return an error rather than pretending that
data was saved.
