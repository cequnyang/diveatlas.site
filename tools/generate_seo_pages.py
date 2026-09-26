#!/usr/bin/env python3
"""Build a small, factual static SEO pilot from DiveAtlas local records."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://diveatlas.site"
SITE_DATA = ROOT / "data" / "dive-sites.js"
PHOTO_DATA = ROOT / "data" / "dive-site-photos.js"
SITEMAP = ROOT / "sitemap.xml"
SITE_OUTPUT = ROOT / "dive-sites"
REGION_OUTPUT = ROOT / "regions"
MIN_SITES_PER_REGION = 3
DEFAULT_SITE_LIMIT = 20
DEFAULT_REGION_LIMIT = 10
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def slug_base(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
    return slug


def region_path(country: str, region: str) -> str:
    region_slug = slug_base(region)
    country_slug = slug_base(country)
    return f"/regions/{country_slug}/{region_slug}/" if country_slug else f"/regions/{region_slug}/"


def html_text(value: object) -> str:
    return html.escape(str(value), quote=True)


def load_rows() -> list[list[object]]:
    source = SITE_DATA.read_text(encoding="utf-8-sig")
    if "=" not in source:
        raise ValueError("Could not find the dive-site dataset assignment")
    rows = json.loads(source.split("=", 1)[1].rsplit(";", 1)[0])
    if not isinstance(rows, list):
        raise ValueError("Dive-site data must be a row array")
    return rows


def load_photos() -> dict[str, dict[str, str]]:
    source = PHOTO_DATA.read_text(encoding="utf-8-sig")
    photos: dict[str, dict[str, str]] = {}
    record_re = re.compile(r'^\s*"([0-9a-f-]{36})"\s*:\s*\{([^{}]*)\}', re.M | re.I)
    field_re = re.compile(r'\b(src|alt|credit|source|license|locationConfidence)\s*:\s*"((?:\\.|[^"\\])*)"')
    for match in record_re.finditer(source):
        fields = {key: json.loads('"' + value + '"') for key, value in field_re.findall(match.group(2))}
        image = fields.get("src", "")
        image_path = ROOT / image
        if fields.get("locationConfidence") == "exact" and fields.get("alt") and image and image_path.is_file():
            photos[match.group(1).lower()] = fields
    return photos


def row_value(row: list[object], index: int) -> str:
    if index >= len(row) or row[index] is None:
        return ""
    if isinstance(row[index], list):
        return " | ".join(str(value).strip() for value in row[index] if str(value).strip())
    return str(row[index]).strip()


def validated_candidates(rows: list[list[object]], photos: dict[str, dict[str, str]]) -> tuple[list[dict[str, object]], dict[str, int]]:
    id_counts = Counter(row_value(row, 12).lower() for row in rows if row_value(row, 12))
    coord_counts = Counter((row[1], row[2]) for row in rows if len(row) > 2)
    rejected = Counter()
    candidates: list[dict[str, object]] = []

    for row in rows:
        name = row_value(row, 0)
        site_id = row_value(row, 12).lower()
        country = row_value(row, 9)
        region = row_value(row, 10)
        if not name:
            rejected["missing_name"] += 1
            continue
        if "\ufffd" in name or any(unicodedata.category(char) == "Cc" for char in name):
            rejected["invalid_name_encoding"] += 1
            continue
        if not UUID_RE.fullmatch(site_id) or id_counts[site_id] != 1:
            rejected["missing_or_duplicate_stable_id"] += 1
            continue
        lat, lon = row[1], row[2]
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            rejected["invalid_coordinates"] += 1
            continue
        if coord_counts[(lat, lon)] != 1:
            rejected["duplicate_coordinates"] += 1
            continue
        if not country and not region:
            rejected["missing_location_context"] += 1
            continue

        photo = photos.get(site_id)
        depth_min, depth_max = row_value(row, 3), row_value(row, 4)
        difficulty, characteristics = row_value(row, 6), row_value(row, 7)
        aliases, sources = row_value(row, 11), row_value(row, 8)
        attributes = [bool(depth_min or depth_max), bool(difficulty), bool(characteristics), bool(aliases), bool(sources), bool(photo)]
        score = sum(attributes)
        if score < 2:
            rejected["insufficient_factual_attributes"] += 1
            continue
        candidates.append({
            "name": name,
            "lat": lat,
            "lon": lon,
            "site_id": site_id,
            "country": country,
            "region": region,
            "depth_min": depth_min,
            "depth_max": depth_max,
            "difficulty": difficulty,
            "characteristics": characteristics,
            "aliases": aliases,
            "sources": sources,
            "photo": photo,
            "score": score,
            "row": row,
        })

    # Resolve collisions against the full eligible pool, not only the current cap,
    # so raising a limit later does not rename pages already in the pilot.
    slug_counts = Counter(slug_base(str(site["name"])) for site in candidates)
    used_slugs: set[str] = set()
    for site in candidates:
        base = slug_base(str(site["name"])) or f"site-{str(site['site_id'])[:8]}"
        if slug_counts[slug_base(str(site["name"]))] > 1:
            place = "-".join(filter(None, (slug_base(str(site["region"])), slug_base(str(site["country"])))))
            base = f"{base}-{place}" if place else base
        if base in used_slugs:
            base = f"{base}-{str(site['site_id'])[:8]}"
        # Even collision suffixes are checked, rather than silently overwriting.
        if base in used_slugs:
            raise ValueError(f"Unresolved site slug collision: {base}")
        used_slugs.add(base)
        site["slug"] = base

    candidates.sort(key=lambda site: (-int(site["score"]), str(site["name"]).casefold(), str(site["country"]).casefold(), str(site["region"]).casefold(), float(site["lat"]), float(site["lon"]), str(site["site_id"])))
    return candidates, dict(rejected)


def page_shell(title: str, description: str, canonical: str, body: str) -> str:
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html_text(title)}</title>
  <meta name="description" content="{html_text(description)}">
  <link rel="canonical" href="{html_text(canonical)}">
  <link rel="stylesheet" href="/assets/seo.css">
</head>
<body>
{body}
</body>
</html>
'''


def item_list(items: list[dict[str, object]], render_item) -> str:
    return "\n".join(f"      <li>{render_item(item)}</li>" for item in items)


def generate_site_page(site: dict[str, object], regions: dict[tuple[str, str], dict[str, object]]) -> tuple[str, str]:
    slug = str(site["slug"])
    url = f"{BASE_URL}/dive-sites/{quote(slug)}/"
    name, country, region = str(site["name"]), str(site["country"]), str(site["region"])
    location = ", ".join(value for value in (region, country) if value)
    coordinate_text = f"{float(site['lat']):.5f}, {float(site['lon']):.5f}"
    context = f" in {location}" if location else ""
    title_base = f"{name} Dive Site{f' in {location}' if location else ''} | DiveAtlas"
    description = f"Explore {name}{context} on DiveAtlas. View its mapped coordinates ({coordinate_text}) and the available site details and listed sources."
    place_key = (country.casefold(), region.casefold())
    region_entry = regions.get(place_key)
    region_link = ""
    if region_entry:
        region_link = f'<p><strong>Region:</strong> <a href="{html_text(region_entry["path"]) }">{html_text(region)}{", " + html_text(country) if country else ""}</a></p>'

    facts: list[str] = [f'<p><strong>Coordinates:</strong> <span>{html_text(coordinate_text)}</span></p>']
    if country:
        facts.append(f'<p><strong>Country:</strong> {html_text(country)}</p>')
    if region:
        facts.append(f'<p><strong>Region:</strong> {html_text(region)}</p>')
    if site["depth_min"] or site["depth_max"]:
        depth = "–".join(value for value in (str(site["depth_min"]), str(site["depth_max"])) if value)
        facts.append(f'<p><strong>Recorded depth range:</strong> {html_text(depth)} m</p>')
    if site["difficulty"]:
        facts.append(f'<p><strong>Listed diver levels:</strong> {html_text(site["difficulty"])}</p>')
    if site["characteristics"]:
        facts.append(f'<p><strong>Listed site characteristics:</strong> {html_text(site["characteristics"])}</p>')
    if site["aliases"]:
        facts.append(f'<p><strong>Other recorded names:</strong> {html_text(site["aliases"])}</p>')
    if site["sources"]:
        facts.append(f'<p><strong>Listed data sources:</strong> {html_text(site["sources"])}</p>')

    photo_markup = ""
    photo = site["photo"]
    if photo:
        image_url = "/" + str(photo["src"]).lstrip("/")
        photo_markup = f'<figure><img src="{html_text(image_url)}" alt="{html_text(photo["alt"])}" loading="lazy"><figcaption>{html_text(photo.get("credit", ""))}</figcaption></figure>'

    map_url = f"{BASE_URL}/?site={quote(str(site['site_id']))}"
    body = f'''<header class="site-header"><a href="/" class="brand">DiveAtlas</a><nav aria-label="Browse"><a href="/dive-sites/">Dive sites</a><a href="/regions/">Regions</a></nav></header>
<main>
  <p class="eyebrow">Mapped dive site</p>
  <h1>{html_text(name)}</h1>
  <p class="lead">{html_text(location) if location else "Dive site"} · {html_text(coordinate_text)}</p>
  <section aria-labelledby="site-details-heading"><h2 id="site-details-heading">Site details</h2>{''.join(facts)}{region_link}</section>
  {photo_markup}
  <p class="map-link"><a href="{html_text(map_url)}">Open this dive site in the interactive map</a></p>
</main>
<footer><a href="/dive-sites/">All pilot dive sites</a> · <a href="/">DiveAtlas map</a></footer>'''
    return title_base, page_shell(title_base, description, url, body)


def generate_region_page(group: dict[str, object], groups: list[dict[str, object]]) -> tuple[str, str]:
    country, region = str(group["country"]), str(group["region"])
    path = region_path(country, region)
    url = f"{BASE_URL}{path}"
    sites = list(group["sites"])
    title = f"Dive Sites in {region}, {country} | DiveAtlas" if country else f"Dive Sites in {region} | DiveAtlas"
    country_suffix = f", {country}" if country else ""
    description = f"Browse {len(sites)} pilot dive-site pages mapped in {region}{country_suffix}. Compare recorded locations and available site details on DiveAtlas."
    latitudes = [float(site["lat"]) for site in sites]
    longitudes = [float(site["lon"]) for site in sites]
    bounds = f"{min(latitudes):.5f} to {max(latitudes):.5f} latitude; {min(longitudes):.5f} to {max(longitudes):.5f} longitude"
    site_items = item_list(sites, lambda site: f'<a href="/dive-sites/{quote(str(site["slug"]))}/">{html_text(site["name"])}</a> <span class="coordinates">({float(site["lat"]):.5f}, {float(site["lon"]):.5f})</span>')
    related = [other for other in groups if other is not group and str(other["country"]).casefold() == country.casefold()]
    related_markup = ""
    if related:
        related_markup = '<section aria-labelledby="related-heading"><h2 id="related-heading">Other pilot regions in this country</h2><ul>' + item_list(related, lambda other: f'<a href="{html_text(other["path"])}">{html_text(other["region"])}</a>') + '</ul></section>'
    body = f'''<header class="site-header"><a href="/" class="brand">DiveAtlas</a><nav aria-label="Browse"><a href="/dive-sites/">Dive sites</a><a href="/regions/">Regions</a></nav></header>
<main>
  <p class="eyebrow">Region browse page</p>
  <h1>Dive Sites in {html_text(region)}</h1>
  <p class="lead">{html_text(country)}</p>
  <p>This pilot page lists {len(sites)} dive sites with recorded country and region fields matching this group. The coordinate range is {html_text(bounds)}.</p>
  <p><a href="{html_text(BASE_URL)}/?lat={sum(latitudes)/len(latitudes):.5f}&amp;lng={sum(longitudes)/len(longitudes):.5f}&amp;z=7&amp;layers=dive">View this area on the interactive map</a></p>
  <section aria-labelledby="sites-heading"><h2 id="sites-heading">Dive sites ({len(sites)})</h2><ul class="site-list">{site_items}</ul></section>
  {related_markup}
</main>
<footer><a href="/regions/">All pilot regions</a> · <a href="/">DiveAtlas map</a></footer>'''
    return title, page_shell(title, description, url, body)


def write_page(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = "\n".join(line.rstrip() for line in content.splitlines()) + "\n"
    path.write_text(normalized, encoding="utf-8", newline="\n")


def build(args: argparse.Namespace) -> dict[str, object]:
    rows, photos = load_rows(), load_photos()
    candidates, rejected = validated_candidates(rows, photos)
    selected = candidates[:args.site_limit]

    buckets: dict[tuple[str, str], dict[str, object]] = {}
    for site in selected:
        country, region = str(site["country"]), str(site["region"])
        if not region:
            continue
        key = (country.casefold(), region.casefold())
        bucket = buckets.setdefault(key, {"country": country, "region": region, "sites": []})
        bucket["sites"].append(site)
    eligible_regions = [group for group in buckets.values() if len(group["sites"]) >= MIN_SITES_PER_REGION]
    eligible_regions.sort(key=lambda group: (-len(group["sites"]), str(group["country"]).casefold(), str(group["region"]).casefold()))
    regions = eligible_regions[:args.region_limit]
    for group in regions:
        group["path"] = region_path(str(group["country"]), str(group["region"]))
    region_by_place = {(str(group["country"]).casefold(), str(group["region"]).casefold()): group for group in regions}

    # The two output trees are generator-owned. This makes lower future limits
    # remove stale pages rather than leave URLs behind in the sitemap.
    for output in (SITE_OUTPUT, REGION_OUTPUT):
        if output.exists():
            shutil.rmtree(output)
    SITE_OUTPUT.mkdir()
    REGION_OUTPUT.mkdir()

    sitemap_urls = [f"{BASE_URL}/", f"{BASE_URL}/dive-sites/", f"{BASE_URL}/regions/"]
    titles: set[str] = set()
    descriptions: set[str] = set()
    for site in selected:
        title, content = generate_site_page(site, region_by_place)
        if title in titles:
            place = ", ".join(value for value in (str(site["region"]), str(site["country"])) if value)
            title = f"{site['name']} in {place} ({float(site['lat']):.5f}, {float(site['lon']):.5f}) | DiveAtlas"
            content = content.replace(re.search(r"<title>.*?</title>", content, re.S).group(0), f"<title>{html_text(title)}</title>", 1)
        if title in titles:
            raise ValueError(f"Duplicate generated title: {title}")
        titles.add(title)
        canonical = f"{BASE_URL}/dive-sites/{quote(str(site['slug']))}/"
        description = re.search(r'<meta name="description" content="([^"]*)">', content).group(1)
        if description in descriptions:
            raise ValueError(f"Duplicate generated description for {canonical}")
        descriptions.add(description)
        write_page(SITE_OUTPUT / str(site["slug"]) / "index.html", content)
        sitemap_urls.append(canonical)

    site_index_items = item_list(selected, lambda site: f'<a href="/dive-sites/{quote(str(site["slug"]))}/">{html_text(site["name"])}</a> <span class="coordinates">{html_text(", ".join(value for value in (str(site["region"]), str(site["country"])) if value))}</span>')
    site_index_body = f'''<header class="site-header"><a href="/" class="brand">DiveAtlas</a><nav aria-label="Browse"><a href="/dive-sites/">Dive sites</a><a href="/regions/">Regions</a></nav></header>
<main><p class="eyebrow">Factual page pilot</p><h1>Dive Sites</h1><p>Browse {len(selected)} dive-site pages selected from DiveAtlas records with stable IDs, valid unique coordinates, recorded location context and multiple factual attributes. This is a data-completeness pilot, not a popularity ranking.</p><ul class="site-list">{site_index_items}</ul></main>
<footer><a href="/regions/">Browse pilot regions</a> · <a href="/">DiveAtlas map</a></footer>'''
    write_page(SITE_OUTPUT / "index.html", page_shell("Dive Sites | DiveAtlas", "Browse the DiveAtlas pilot set of mapped dive sites with recorded locations and factual site details.", f"{BASE_URL}/dive-sites/", site_index_body))

    region_index_items = item_list(regions, lambda group: f'<a href="{html_text(group["path"])}">{html_text(group["region"])}</a> <span class="coordinates">{(html_text(group["country"]) + " · ") if group["country"] else ""}{len(group["sites"])} sites</span>')
    region_index_body = f'''<header class="site-header"><a href="/" class="brand">DiveAtlas</a><nav aria-label="Browse"><a href="/dive-sites/">Dive sites</a><a href="/regions/">Regions</a></nav></header>
<main><p class="eyebrow">Factual page pilot</p><h1>Dive Site Regions</h1><p>Browse {len(regions)} country and region groups that each contain at least {MIN_SITES_PER_REGION} generated pilot dive-site pages. Names and counts come from recorded DiveAtlas location fields.</p><ul class="site-list">{region_index_items}</ul></main>
<footer><a href="/dive-sites/">Browse pilot dive sites</a> · <a href="/">DiveAtlas map</a></footer>'''
    write_page(REGION_OUTPUT / "index.html", page_shell("Dive Site Regions | DiveAtlas", "Browse DiveAtlas region pages grouped from recorded dive-site country and region fields.", f"{BASE_URL}/regions/", region_index_body))

    for group in regions:
        title, content = generate_region_page(group, regions)
        if title in titles:
            raise ValueError(f"Duplicate generated title: {title}")
        titles.add(title)
        write_page(ROOT / str(group["path"]).lstrip("/") / "index.html", content)
        sitemap_urls.append(f"{BASE_URL}{str(group['path'])}")

    # Build XML using the standard sitemap namespace; no fabricated freshness fields.
    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    ET.register_namespace("", namespace)
    urlset = ET.Element(f"{{{namespace}}}urlset")
    for url in sitemap_urls:
        ET.SubElement(ET.SubElement(urlset, f"{{{namespace}}}url"), f"{{{namespace}}}loc").text = url
    ET.indent(urlset, space="  ")
    xml = ET.tostring(urlset, encoding="unicode", xml_declaration=False)
    SITEMAP.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + xml + "\n", encoding="utf-8", newline="\n")

    return {"site_count": len(selected), "region_count": len(regions), "candidate_count": len(candidates), "rejected": rejected, "sitemap_url_count": len(sitemap_urls), "site_urls": [f"{BASE_URL}/dive-sites/{site['slug']}/" for site in selected], "region_urls": [f"{BASE_URL}{group['path']}" for group in regions], "region_threshold": MIN_SITES_PER_REGION}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-limit", type=int, default=DEFAULT_SITE_LIMIT)
    parser.add_argument("--region-limit", type=int, default=DEFAULT_REGION_LIMIT)
    args = parser.parse_args()
    if args.site_limit < 0 or args.region_limit < 0:
        parser.error("limits must be zero or greater")
    print(json.dumps(build(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
