# Dive-site suggestions

When search has no matching dive site, the visitor can submit the prefilled name with an optional region and source link. Suggestions enter a private review queue; they are not added to the public map automatically. The form does not ask for an email address, and the queue does not store visitor IP addresses.

The endpoint is part of the existing `workers/auth` API Worker because that Worker already owns both `/api/*` hostname routes. Keeping one API owner avoids route precedence conflicts with sign-in, callback, profile, and logout endpoints. Suggestion records remain isolated in a separate D1 database.

## Configure and deploy

1. Create the dedicated D1 database:

   ```powershell
   npx wrangler d1 create diveatlas-site-suggestions
   ```

2. The production database ID is already set in `workers/auth/wrangler.jsonc`. If recreating this database in another Cloudflare account, replace that ID with the new database's ID.
3. From `workers/auth`, apply the suggestion schema. Wrangler reads the separate migration directory from the D1 binding in `wrangler.jsonc`:

   ```powershell
   npx wrangler d1 migrations apply diveatlas-site-suggestions --remote
   ```

4. From `workers/auth`, configure the Turnstile secret on the existing auth Worker. Enter it only at Wrangler's interactive prompt:

   ```powershell
   npx wrangler secret put TURNSTILE_SECRET
   ```

   The site key in `index.html` is public; this secret must never be committed.
5. From `workers/auth`, deploy the existing API Worker:

   ```powershell
   npx wrangler deploy
   ```

The existing Worker routes already cover `diveatlas.site/api/*` and `www.diveatlas.site/api/*`; no additional route is needed.

## Local development

The local auth Worker configuration binds a separate local D1 database. From `workers/auth`, apply this migration and start the existing local preview using the instructions in `workers/auth/README.md`:

```powershell
npx wrangler d1 migrations apply diveatlas-site-suggestions-local --local --config wrangler.local.jsonc
```

Local submissions also need `TURNSTILE_SECRET` in `workers/auth/.dev.vars` and a Turnstile widget/site key and secret valid for the local hostname. Do not reuse production credentials in local files.

## Review queue

In the Cloudflare D1 console, select `diveatlas-site-suggestions` and run:

```sql
SELECT site_name, region, source_url, submission_count, first_submitted_at, last_submitted_at
FROM site_suggestions
WHERE status = 'pending'
ORDER BY submission_count DESC, first_submitted_at ASC;
```

Set `status` to `accepted` or `declined` after review. Repeated submissions with the same normalized name and region increment `submission_count` rather than creating duplicate rows. The API validates same-origin requests, field lengths, and optional HTTP(S) source links, and verifies Turnstile tokens server-side before writing to D1.
