// Keep the duplicate check and insert in one D1 statement so concurrent uploads cannot both pass a separate pre-check.
const INSERT_PENDING_SUBMISSION = `
  INSERT INTO site_photo_submissions (
    id, site_id, site_name, submitter_user_id, submitter_email, credit_name,
    object_key, content_type, byte_size, width, height, review_metadata_json, sha256,
    attested_real_location, attested_not_ai_generated, attested_rights,
    license_version, status, submitted_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, 'pending', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM site_photo_submissions
    WHERE site_id = ? AND submitter_user_id = ? AND status = 'pending'
  )
`;

// R2 and D1 cannot share a transaction, so remove the object if its review row fails.
export async function persistPhotoSubmission({
  bucket,
  database,
  bytes,
  submission
}) {
  const { id: submissionId, siteId, objectKey, contentType } = submission;
  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { submissionId, siteId }
  });

  try {
    const result = await database.prepare(INSERT_PENDING_SUBMISSION).bind(
      submission.id,
      submission.siteId,
      submission.siteName,
      submission.submitterUserId,
      submission.submitterEmail,
      submission.creditName,
      submission.objectKey,
      submission.contentType,
      submission.byteSize,
      submission.width,
      submission.height,
      submission.reviewMetadataJson,
      submission.sha256,
      submission.licenseVersion,
      submission.submittedAt,
      submission.siteId,
      submission.submitterUserId
    ).run();
    if (!result?.success || Number(result.meta?.changes) !== 1) {
      throw new Error('Photo review record was not stored');
    }
  } catch (error) {
    try {
      await bucket.delete(objectKey);
    } catch (cleanupError) {
      console.error(JSON.stringify({
        event: 'site_photo_orphan_cleanup_failed',
        submissionId,
        errorName: cleanupError?.name || 'Error'
      }));
    }
    throw error;
  }
}
