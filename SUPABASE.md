# Supabase appointment storage

The booking API stores newly created appointments in Supabase and returns a
confirmation message to the site. The existing `faizii1.json` bookings remain
visible as legacy records; editing one moves it to Supabase, and cancelling it
removes it from the local JSON database. Sign-in accounts remain local.

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

alter table public.appointments enable row level security;
grant select, insert, update, delete on public.appointments to service_role;
```

The server verifies the signed-in user and applies the existing admin/owner
access rules before using the Supabase service-role key. Do not add the key to
frontend code or commit it. Keep the table inaccessible to `anon` and
`authenticated` roles unless a separate, reviewed access policy is required.

## Configure the server

Use Node.js 18 or newer, which provides the server-side `fetch` API used for
Supabase requests.

Copy `faizii1.env` to `faizii1.env.local`, then set:

```dotenv
SUPABASE_REST_URL=https://igowvkdyyxaczkhlgkie.supabase.co/rest/v1
SUPABASE_SERVICE_ROLE_KEY=your_private_service_role_key
```

`faizii1.env.local` is excluded from Git. Restart the Node server after changing
the configuration. If the key is missing or Supabase rejects a request, the
booking API returns an error rather than reporting that the appointment was
saved.
