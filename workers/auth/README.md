# DiveAtlas Google authentication Worker

This is a separate Cloudflare Worker for Google sign-in. GitHub Pages continues to serve the map; when ready, Cloudflare can route only `diveatlas.site/api/*` to this Worker.

The Worker uses Google's authorization-code flow with PKCE, state and nonce validation, validates Google's signed ID token, and creates a random opaque session in D1. Only a hash of the session token is stored in D1. The Worker does not request Google API access beyond the user's basic identity (`openid email profile`) and never stores Google access or refresh tokens.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/google` | Begin Google sign-in |
| `GET` | `/api/auth/google/callback` | Validate Google's response and start a DiveAtlas session |
| `GET` | `/api/auth/me` | Return the current signed-in user's basic profile, or `{"user":null}` |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `POST` | `/api/site-photo-submissions` | Store a dive-site photo privately and create a pending review record |

## Dive-site photo submissions

The fallback image in a dive-site popup has a **Share a real photo** action. Contributors sign in, choose a JPEG, PNG, or WebP image, preview it, and confirm that it depicts the selected site and was not AI-generated. They must own its copyright or have the copyright owner's authority to grant the displayed license. That license permits private review storage and, if approved, resizing and display on the dive-site page; the contributor retains copyright.

The Worker checks the actual image signature and dimensions, caps files at 12 MiB, records a SHA-256 digest and the contributor's attestations, and stores the original in the private `SITE_PHOTO_SUBMISSIONS` R2 bucket. It keeps the GPS/EXIF bytes with that private original so a reviewer can inspect them. It does not try to classify AI-generated images or decide whether GPS proves the dive site. The uploader sees a pending-review receipt; no submitted image is public or replaces the fallback automatically.

Each submission is one row in `site_photo_submissions`, linked by `object_key` and submission ID to its R2 object. The metadata uses the existing `SITE_SUGGESTIONS_DB` review database so the photo and its contributor/site/rights information can later be presented together in a review screen. The original bytes are not modified. A future approval/publishing workflow should create a public derivative with location metadata removed before changing the dive-site photo manifest.

Before public launch, define a retention period for pending or declined originals and give contributors a clear removal-request path. The uploader currently records and accepts submissions; it does not include a reviewer dashboard or a contributor status/history page.

The session cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, and expires after 14 days. Authentication responses are marked `Cache-Control: no-store`. No CORS access is enabled; the intended browser client is the same-origin DiveAtlas site.

The account menu shows the signed-in user's Google name and email, displays sign-in or sign-out as appropriate, and confirms successful login and logout. Auth controls stay hidden when the API is unavailable, so the static site remains usable before its `/api/*` route is connected.

## Local development

You can run the site and Worker together on `http://localhost:8787`. Wrangler uses a local D1 database; this workflow does not read or write the remote database configured for production. Port 8765 is already used by the site's existing Python preview on this machine.

1. Build a lightweight local preview from the repository root. This omits the very large R2/Tide data payloads so it finishes quickly; use the normal `npm run build` when you need a complete, deployable Pages artifact.

   ```powershell
   npm run build:auth-preview
   ```

2. Copy `.dev.vars.example` to `.dev.vars` in this directory and set a Google OAuth **Web application** client ID and secret. In that OAuth client, add this exact local redirect URI:

   ```text
   http://localhost:8787/api/auth/google/callback
   ```

   Google's server-side OAuth flow permits localhost redirects for development. The production callback remains HTTPS.

3. From this directory, create the local database tables and start the local Worker/site:

   ```powershell
   npx wrangler d1 migrations apply diveatlas-auth-local --local --config wrangler.local.jsonc
   npx wrangler d1 migrations apply diveatlas-site-suggestions-local --local --config wrangler.local.jsonc
   npx wrangler dev --config wrangler.local.jsonc --port 8787
   ```

4. Open `http://localhost:8787/`. Choose **Menu → Sign in with Google**. The local D1 database persists under Wrangler's local state directory between runs.

The local configuration is separate from `wrangler.jsonc`, uses the local-only preview in `_site`, and does not deploy anything. Wrangler uses its local R2 emulator for the photo bucket binding; uploads stay on this machine and do not use the production R2 bucket. Map layers backed by omitted datasets will not load in this preview. The automated Worker tests use a temporary signing key and mocked Google endpoints, so they run without `.dev.vars`:

```powershell
npm test --prefix workers/auth
```

Do not copy local secrets into the production Worker. Configure production secrets and routing separately only when you're ready to deploy.

## Google OAuth setup

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client with application type **Web application**.
2. Add the production callback URI exactly as `https://diveatlas.site/api/auth/google/callback`.
3. Use only the basic OpenID Connect scopes requested by this Worker: `openid`, `email`, and `profile`. No JavaScript origin is needed for this server-side callback flow.
4. Before public production use, ensure the OAuth consent configuration meets Google's current homepage, authorized-domain, privacy-policy, and terms requirements.

The production callback assumes the Worker is eventually routed at `diveatlas.site/api/*`. Keep the route unattached until the Worker is deployed and configured.

## Production setup

1. Apply the migration to the already-created remote D1 database:

   ```powershell
   npx wrangler d1 migrations apply diveatlas-auth --remote
   npx wrangler d1 migrations apply diveatlas-site-suggestions --remote --config wrangler.jsonc
   ```

2. Set the Google client ID and client secret as Worker secrets. The client ID is not confidential, but storing both through the secret interface keeps setup simple and avoids committing deployment-specific values:

   ```powershell
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

3. Deploy this Worker from this directory:

   ```powershell
   npx wrangler deploy
   ```

4. After the main website deployment is ready and the Worker configuration is verified, add the route `diveatlas.site/api/*` in the Worker dashboard. The callback URL and `APP_ORIGIN` are set in `wrangler.jsonc` for that route.
5. The site UI reads `/api/auth/me` and signs out by POSTing to `/api/auth/logout` with same-origin credentials.

The production configuration expects a private R2 bucket named `diveatlas-user-photo-submissions`. Create that bucket before deploying the photo endpoint. The endpoint has no public image-read route; a review tool must use the Worker binding to load a pending original.

Do not commit `.dev.vars`, Google credentials, session cookies, or user data. Do not expose the D1 REST API or credentials to browser code.

## Data and limits

The first migration stores the Google subject and a minimal profile (verified email, display name, and optional Google-hosted avatar URL), plus hashed opaque session tokens. It intentionally does not store a password or Google API tokens. Expired sessions are removed during successful sign-in; the account's identity row remains until an explicit account-deletion feature is implemented.

Review Cloudflare's current Workers and D1 quotas before launch. The free-tier daily D1 limits can cause authentication requests to fail if exceeded, so monitor usage as sign-ins grow.
