/*
 * Verified dive-site photos keyed only by persistent DiveAtlas site UUIDs.
 *
 * Example record shape:
 * "<stable-site-id>": {
 *   siteId: "<stable-site-id>",
 *   src: "assets/dive-sites/<stable-site-id>/hero.webp",
 *   alt: "Meaningful description of the exact site photo",
 *   credit: "Photographer name",
 *   source: "personal",
 *   license: "owned",
 *   locationConfidence: "exact",
 *   capturedAt: "2025-04" // optional
 * }
 *
 * Each dive-site row stores its persistent DiveAtlas UUID at array field [12].
 * UUIDs were assigned once and are part of the local dataset; preserve them
 * when editing or rebuilding that data. Never derive them from coordinates,
 * names, translations, or array order. Add a photo only when it is confirmed
 * for the exact site and key it with that row's stored UUID.
 */
window.DIVE_SITE_PHOTOS = {
  "06d24036-5d88-4c05-821d-6d65d4c98888": {
    siteId: "06d24036-5d88-4c05-821d-6d65d4c98888",
    src: "assets/dive-sites/06d24036-5d88-4c05-821d-6d65d4c98888/hero.webp",
    alt: "A manta ray gliding through blue water at Irvin's Mantas.",
    credit: "User-provided",
    source: "personal",
    license: "owned",
    locationConfidence: "exact"
  },
  "cf0fd999-e9f1-4a33-9015-a5a448903511": {
    siteId: "cf0fd999-e9f1-4a33-9015-a5a448903511",
    src: "assets/dive-sites/cf0fd999-e9f1-4a33-9015-a5a448903511/hero.webp",
    alt: "A diver exploring the underwater wall at Pangalisan.",
    credit: "User-provided",
    source: "personal",
    license: "owned",
    locationConfidence: "exact"
  },
  "0409f536-7eab-4b6e-ba24-2b456be52b63": {
    siteId: "0409f536-7eab-4b6e-ba24-2b456be52b63",
    src: "assets/dive-sites/0409f536-7eab-4b6e-ba24-2b456be52b63/hero.webp",
    alt: "A deep blue underwater view at Fam Slope.",
    credit: "User-provided",
    source: "personal",
    license: "owned",
    locationConfidence: "exact"
  },
  "ccc7232b-8591-44df-afe7-264d8239566a": {
    siteId: "ccc7232b-8591-44df-afe7-264d8239566a",
    src: "assets/dive-sites/ccc7232b-8591-44df-afe7-264d8239566a/hero.webp",
    alt: "A school of colorful reef fish at Friwen Wall.",
    credit: "User-provided",
    source: "personal",
    license: "owned",
    locationConfidence: "exact"
  },
  "f7d2465f-0fe3-421d-9b35-2337c9d457f1": {
    siteId: "f7d2465f-0fe3-421d-9b35-2337c9d457f1",
    src: "assets/dive-sites/f7d2465f-0fe3-421d-9b35-2337c9d457f1/hero.webp",
    alt: "A colorful coral reef at Blue Magic.",
    credit: "User-provided",
    source: "personal",
    license: "owned",
    locationConfidence: "exact"
  },
  "a7ced4d1-f0e1-486c-b524-d08036c9673a": {
    siteId: "a7ced4d1-f0e1-486c-b524-d08036c9673a",
    src: "assets/dive-sites/a7ced4d1-f0e1-486c-b524-d08036c9673a/hero.webp",
    alt: "Branching corals rising through blue water at Tapor Tamiyam.",
    credit: "User-provided",
    source: "personal",
    license: "owned",
    locationConfidence: "exact"
  }
};
