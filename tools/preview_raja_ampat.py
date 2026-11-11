"""Regenerate only Raja Ampat's landing HTML for local review, without rebuilding other pages.

Run from the repository root: python -m tools.preview_raja_ampat
"""
from . import generate_seo_pages as seo


def main():
    fallback_base, fallbacks = seo.load_fallback_photos()
    candidates, _ = seo.validated_candidates(
        seo.load_rows(), seo.load_photos(), seo.load_summaries(), fallback_base, fallbacks,
    )
    buckets = {}
    for site in candidates:
        if not site["region"]:
            continue
        key = (site["country"].casefold(), site["region"].casefold())
        group = buckets.setdefault(key, {"country": site["country"], "region": site["region"], "sites": []})
        group["sites"].append(site)
    groups = [group for group in buckets.values() if len(group["sites"]) >= seo.MIN_SITES_PER_REGION]
    groups.sort(key=lambda group: (-len(group["sites"]), group["country"].casefold(), group["region"].casefold()))
    for group in groups:
        group["path"] = seo.region_path(group["country"], group["region"])
    group = buckets[("indonesia", "raja ampat")]
    photo = seo.load_destination_photos(groups)[group["path"]]
    _, content = seo.generate_region_page(group, groups, photo)
    target = seo.ROOT / group["path"].lstrip("/") / "index.html"
    target.write_text(content, encoding="utf-8", newline="\n")
    print(f"Updated {target} ({len(group['sites'])} recorded sites)")


if __name__ == "__main__":
    main()
