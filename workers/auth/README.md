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
   npx wrangler dev --config wrangler.local.jsonc --port 8787
   ```

4. Open `http://localhost:8787/`. Choose **Menu → Sign in with Google**. The local D1 database persists under Wrangler's local state directory between runs.

The local configuration is separate from `wrangler.jsonc`, uses the local-only preview in `_site`, and does not deploy anything. Map layers backed by omitted datasets will not load in this preview. The automated Worker tests use a temporary signing key and mocked Google endpoints, so they run without `.dev.vars`:

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

Do not commit `.dev.vars`, Google credentials, session cookies, or user data. Do not expose the D1 REST API or credentials to browser code.

## Data and limits

The first migration stores the Google subject and a minimal profile (verified email, display name, and optional Google-hosted avatar URL), plus hashed opaque session tokens. It intentionally does not store a password or Google API tokens. Expired sessions are removed during successful sign-in; the account's identity row remains until an explicit account-deletion feature is implemented.

Review Cloudflare's current Workers and D1 quotas before launch. The free-tier daily D1 limits can cause authentication requests to fail if exceeded, so monitor usage as sign-ins grow.
