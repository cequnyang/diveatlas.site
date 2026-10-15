ALTER TABLE site_photo_submissions
  ADD COLUMN review_metadata_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(review_metadata_json));
