# DiveAtlas photo upload Worker

This Worker accepts dive-site photo submissions and writes image bytes privately to R2 with review details in a dedicated D1 database. It owns only `/api/site-photo-submissions`; the auth Worker continues to own Google sign-in and site suggestions.

## How it works

The browser prepares a JPEG, PNG, or WebP photo and uploads it with the site, credit, attestations, and a small allowlisted record of review metadata. The Worker uses `AUTH_DB` only to verify the existing sign-in session, `SITE_PHOTOS_BUCKET` for the private `diveatlas-user-photo-submissions` R2 bucket, and `SITE_PHOTOS_DB` for the dedicated `diveatlas-site-photos` review database. The binary image stays in R2; D1 stores its object key, dimensions, review metadata, attestations, and submission status.

The request handler validates the submission, then `photo-submission-storage.js` writes the R2 object and its D1 review row. A single conditional D1 insert prevents two simultaneous requests from creating duplicate pending submissions for the same site and user. R2 and D1 do not share a transaction, so a failed D1 insert triggers a compensating R2 delete; cleanup failures are logged for follow-up.

The Worker does not implement Google OAuth or expose a public photo-read route. It reuses the auth Worker session cookie and session table through a shared validator; it does not need Google client secrets. Cloudflare's more-specific photo route takes precedence over the auth Worker's generic `/api/*` routes.

The browser extracts GPS, optional altitude, capture time, and source dimensions before compression. Only those review-relevant fields are sent separately from the compressed image; unrelated EXIF fields are not copied into the review record. GPS and capture time are untrusted clues. Original image bytes are private in R2, and no submission is displayed publicly until a separate review/publishing process approves it.

## Local development

Run the auth Worker and static preview at `http://localhost:8787` as described in `workers/auth/README.md`. Apply the photo migrations locally, then start this Worker from this directory:

```powershell
npx wrangler d1 migrations apply diveatlas-site-photos-local --local --config wrangler.local.jsonc --persist-to ../../.wrangler
npx wrangler dev --config wrangler.local.jsonc --port 8788 --persist-to ../../.wrangler
```

The site points local photo submissions at port 8788. Local CORS accepts only `http://localhost:8787`, and the shared persistence folder lets the photo Worker read the local auth session and write to the same local review D1 and R2 emulator state. These bindings use local resources only.

## Production deployment

1. Confirm `diveatlas-user-photo-submissions` is private and exists. Do not enable public bucket access.
2. From this directory, apply the photo schema to the dedicated database:

   ```powershell
   npx wrangler d1 migrations apply diveatlas-site-photos --remote --config wrangler.jsonc
   ```

3. From this directory, build and deploy this Worker:

   ```powershell
   npx wrangler deploy
   ```

The config binds the existing `diveatlas-auth` database as `AUTH_DB` only to look up sessions, binds `diveatlas-site-photos` as `SITE_PHOTOS_DB` for pending review records, and binds the private photo bucket as `SITE_PHOTOS_BUCKET` for object writes. Routes cover both `diveatlas.site` and `www.diveatlas.site`.

After the photo Worker is deployed, redeploy `workers/auth` so its current code no longer contains the upload endpoint and its configuration no longer binds the photo bucket. Its generic `/api/*` routes remain in place.

The former `site_photo_submissions` table in `diveatlas-site-suggestions` had zero rows when this database was created. Its old schema migrations remain there for migration-history continuity, but new photo records are written only to `diveatlas-site-photos`.

## Review and retention

Each accepted upload creates a `pending` row in `site_photo_submissions` in `diveatlas-site-photos` and a matching `pending/<submission-id>/submission.<extension>` object in R2. There is no public image URL or reviewer interface yet. Before public launch, define retention for pending or declined originals and add a contributor removal-request path. When a reviewer approves a photo, publish a derivative with location metadata removed rather than exposing the private original.
