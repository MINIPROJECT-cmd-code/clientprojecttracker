# Production Setup

## Supabase Database

Create a Supabase project, then run this SQL:

```sql
create table if not exists app_state (
  id text primary key,
  data jsonb not null
);

insert into app_state (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;
```

Add these Render environment variables:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_TABLE=app_state
```

If these are not set, the app falls back to `db.json`.

## Resend Email

The Resend error happens because `onboarding@resend.dev` can only send test emails to your own Resend account email.

For real client emails:

1. Verify a domain in Resend.
2. Add these Render environment variables:

```text
RESEND_API_KEY=your-resend-api-key
RESEND_FROM=ProjectFlow <noreply@yourdomain.com>
APP_URL=https://client-project-tracker-c93fc.web.app
```

`RESEND_FROM` must use a sender address from a verified Resend domain. Until the API key and verified sender are configured, the app creates invite/reset links and shows them manually instead of blocking the workflow. Direct invoice/reminder emails report the Resend configuration error instead of pretending they were sent.
