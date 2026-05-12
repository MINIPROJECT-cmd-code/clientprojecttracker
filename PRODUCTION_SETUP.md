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

## Email Sending

The app supports SMTP and Resend. SMTP is used automatically when `SMTP_HOST` is configured. Resend is used when SMTP is not configured, unless you force a provider with `EMAIL_PROVIDER`.

### SMTP

For Gmail, use an app password, not your normal Google password. Add these environment variables locally in `.env` and on Render:

```text
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_STARTTLS=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM=ProjectFlow <your-email@gmail.com>
APP_URL=https://client-project-tracker-c93fc.web.app
```

For port `465`, use `SMTP_SECURE=true`.

On Render, open your `client-project-tracker` web service, go to **Environment**, add the variables above, then choose **Save and deploy**. Render can also import values with **Add from .env**, but do not commit your real `.env` file.

Use your public frontend URL for `APP_URL`, for example your Firebase Hosting URL. This is the link clients receive for portal invites and password resets.

### Resend

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
