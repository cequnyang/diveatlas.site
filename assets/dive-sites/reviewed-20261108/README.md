# Additional locally assigned photographs

59 UUID-bound photographs replace illustrations through the existing shared hero and thumbnail components, preserving their layouts. See assignments.json for source descriptions, exact source/licence links, creator credits, original SHA256 and dimensions, crop rectangles and separate identity/rights/publication statuses. JPEG derivatives are cropped/resized only, with no new colour or sharpness edits. Preserve source, creator, licence and modification notices, including the applicable ShareAlike version. Licence metadata is not proof of ownership.

Originals and the100-candidate research results remain untouched under data/image-discovery-hour-20261108. Selection and held-candidate reasons are in data/image-application-additional-20261108/decisions.json. Nine supporting-only images are not heroes or thumbnails;32 further candidates are held. The previous40 assignments are unchanged. The owner authorized local integration, not deployment/publication or independent identity/rights approval.

Stage: python maintenance/apply_additional_reviewed_photos.py --decisions data/image-application-additional-20261108/decisions.json

After crop inspection, append --apply, then run python maintenance/build_reviewed_site_thumbnails.py. No network requests are made. Source originals and the local decision file are required.
