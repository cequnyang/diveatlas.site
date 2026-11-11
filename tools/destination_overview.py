"""Shared destination landing pages; directory pagination stays generator-owned."""

import re
import json
from html import escape
from pathlib import Path
import hashlib


def destination_map_key(path):
    if path == '/regions/indonesia/raja-ampat/':
        return 'raja-ampat'
    return 'destination-' + hashlib.sha256(path.encode('utf-8')).hexdigest()[:16]


def starting_sites(sites, feature_tokens):
    """Deterministic feature coverage, not a quality or suitability ranking."""
    remaining = sorted(sites, key=lambda s: (str(s['name']).casefold(), str(s.get('site_id', s['slug']))))
    chosen, covered, identities = [], set(), set()
    while remaining and len(chosen) < 3:
        site = min(remaining, key=lambda s: (-len(set(feature_tokens(s)) - covered),
                   str(s['name']).casefold(), str(s.get('site_id', s['slug']))))
        remaining.remove(site)
        identity = site.get('canonical_id', site.get('site_id', site['slug']))
        if identity in identities:
            continue
        identities.add(identity)
        chosen.append(site)
        covered.update(feature_tokens(site))
    return chosen


def destination_overview(group, breadcrumbs, photo, render_card, feature_tokens):
    sites, region, country = group['sites'], str(group['region']), str(group['country'])
    path = str(group.get('path') or '')
    is_raja = path == '/regions/indonesia/raja-ampat/' or (country == 'Indonesia' and region == 'Raja Ampat')
    root = Path(__file__).resolve().parents[1]
    inset = ""
    key = destination_map_key(path)
    registry_path = root / 'datasets/destination-maps.json'
    published = json.loads(registry_path.read_text(encoding='utf-8'))['maps'] if registry_path.exists() else {}
    manifest_path = root / 'assets/destination-maps' / (key + '.json')
    manifest = published.get(key)
    if manifest_path.exists():
        local = json.loads(manifest_path.read_text(encoding='utf-8'))
        # A newly rendered fingerprint stays local until its upload is verified.
        if not manifest or manifest['fingerprint'] != local['fingerprint']:
            manifest = local
    if manifest:
        if manifest['src'].startswith('https://assets.diveatlas.site/assets/destination-maps/') or (root / manifest['src'].lstrip('/')).is_file():
            inset = f'''<aside class="destination-map-inset" aria-label="Raja Ampat location map">
              <a class="destination-map-inset__link" href="{escape(manifest['mapHref'], quote=True)}" aria-label="Explore Raja Ampat on the main map">
                <img src="{escape(manifest['src'], quote=True)}" width="600" height="600" alt="Raja Ampat coastline and nearby places. Marker shows the mean of recorded site coordinates, not an individual dive site.">
              </a><div class="destination-map-inset__credits"><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://openfreemap.org/">OpenFreeMap</a></div>
            </aside>'''
    photo = photo.replace('loading="lazy"', 'loading="eager" fetchpriority="high"')
    # Place attribution inside the same photo/gallery structure as detail pages.
    # Shared caption rules own its scale, offsets and theme treatment.
    image = re.search(r'<img\b[^>]*>', photo)
    credit = re.search(r'<div class="destination-photo-credit-overlay">(.*?)</div>', photo, re.S)
    if image and credit:
        photo = (f'<div class="site-photo-feature destination-hero-photo"><figure class="site-photo">'
                 f'<div class="site-photo-gallery-main"><div class="site-photo-preview-trigger">{image.group(0)}</div>'
                 f'<figcaption class="destination-photo-caption">{credit.group(1)}</figcaption>'
                 '</div></figure></div>')
    shortlist = (
        "tapor-tamiyam-cape-kri-raja-ampat", "blue-magic", "arborek-jetty",
    )
    by_slug = {site["slug"]: site for site in sites}
    cards = []
    chosen = [by_slug[slug] for slug in shortlist if slug in by_slug] if is_raja else starting_sites(sites, feature_tokens)
    for site in chosen:
        slug = site['slug']
        if slug not in by_slug:
            continue
        display_name = "Cape Kri" if slug == "tapor-tamiyam-cape-kri-raja-ampat" else by_slug[slug]["name"]
        card = render_card({**by_slug[slug], "name": display_name})
        cards.append(f"<li>{card}</li>")
    # November is the explicit initial reference, not a computed "best month".
    options = "".join(
        f'<option value="{index}"{" selected" if index == 10 else ""}>{month}</option>'
        for index, month in enumerate([
            "January", "February", "March", "April", "May", "June", "July", "August",
            "September", "October", "November", "December",
        ])
    )
    markup = f'''<main class="detail-page destination-overview" id="detailPage" data-detail-scroll data-i18n-ignore data-destination-name="{escape(region, quote=True)}" data-condition-profile="{'raja-ampat' if is_raja else 'unavailable'}">
  <div class="cinematic-pilot destination-hero-shell">
    <section class="site-hero" aria-labelledby="destination-title">
      {photo}
      {inset}
      <div class="hero-copy">{breadcrumbs}<div class="site-title-row"><h1 id="destination-title"{' class="destination-title--long"' if len(region) > 24 else ''}>{escape(region)}</h1></div></div>
    </section>
  </div>
  <section class="detail-section destination-section" id="destination-seasons" aria-label="Seasonal conditions">
    <div class="destination-season-panel cinematic-pilot">
      <p class="destination-lead" data-destination-text="summary">Reef gardens, ocean pinnacles and island passages in Indonesia. Compare seasonal conditions and explore the dive sites.</p>
      <hr class="destination-summary-divider">
      <noscript><style>.destination-month-control {{ display:none }}</style><p>Showing November’s seasonal notes. Enable JavaScript to compare months.</p></noscript>
      <div class="destination-season-body"><div class="destination-month-control"><div><label for="destination-month" class="sr-only">Planning month</label><select id="destination-month" data-scroll-wheel>{options}</select></div>
      </div>
      <div class="destination-conditions" aria-live="polite" aria-atomic="true">
        <div><h4 data-destination-text="water">Water temperature</h4><strong data-destination-text="temp">~29°C surface</strong><p data-destination-text="annual">Annual surface average</p></div>
        <div><h4 data-destination-text="clarity">Underwater clarity</h4><strong id="destination-clarity">15–20 m reported</strong><p id="destination-clarity-note">Nov–Apr operator range</p></div>
        <div><h4 data-destination-text="currents">Currents &amp; access</h4><strong id="destination-current">Check locally</strong><p id="destination-current-note">Varies by site and tide</p></div>
        <div><h4 data-destination-text="waves">Waves</h4><strong data-destination-text="waveValue">Not available</strong><p data-destination-text="waveNote">No wave data in source</p></div>
      </div></div>
    </div>
    <aside class="record-evidence destination-evidence"><details><summary><span class="note-icon" aria-hidden="true"></span><span class="record-evidence-action" data-destination-text="sources">Sources and notes</span></summary><p><span data-destination-text="sourceIntro">Local guidance from</span> <a href="https://rajaampatbiodiversity.com/dive-into-raja-ampat/">Biodiversity Eco Resort</a><span data-destination-text="sourceNotes">, consulted 11 Nov 2026. Temperature is an annual surface average; visibility is a seasonal operator range. These are not measured monthly climatology, dive-depth readings or live conditions. Confirm conditions with a local guide.</span></p></details></aside>
  </section>
  <section class="detail-section destination-section destination-shortlist site-recommendations site-directory-recommendations cinematic-pilot__recommendations--immersion" aria-labelledby="destination-shortlist-title">
    <div class="destination-section-heading"><h2 id="destination-shortlist-title" data-destination-text="selected">Selected dive sites</h2></div>
    <div class="site-recommendations__content"><ul>{''.join(cards)}</ul></div>
    <p class="destination-source" data-destination-text="selection">Selected for contrasting recorded features. Confirm suitability with a local guide.</p>
  </section>
</main>
<script src="/js/dive-site-detail-i18n.js?v=12" defer></script>
<script src="/js/scroll-wheel.js?v=2" defer></script>
<script src="/js/destination-overview-i18n.js?v=4" defer></script>
<script src="/js/destination-overview.js?v=4" defer></script>
<script src="/js/seo-list-card-ratings.js?v=1" defer></script>'''
    if not is_raja:
        # Strip only the editorial Raja Ampat profile. Unknown conditions must
        # stay unavailable rather than inheriting another destination's numbers.
        markup = re.sub(r'<noscript>.*?</noscript>', '', markup, flags=re.S)
        markup = re.sub(r'<div class="destination-month-control">.*?</select></div>\s*</div>', '', markup, flags=re.S)
        markup = markup.replace('class="destination-season-body"', 'class="destination-season-body destination-season-body--no-month"')
        markup = re.sub(r'(<p class="destination-lead") data-destination-text="summary">.*?</p>',
                        lambda m: m[1] + ' data-destination-text="genericSummary">Explore recorded dive sites in ' + escape(region) + '.</p>', markup)
        markup = markup.replace('<strong data-destination-text="temp">~29°C surface</strong>', '<strong data-destination-text="waveValue">Not available</strong>')
        markup = markup.replace('<p data-destination-text="annual">Annual surface average</p>', '<p data-destination-text="genericConditionNote">No sourced destination-level data</p>')
        markup = re.sub(r'<strong id="destination-(clarity|current)">.*?</strong>', '<strong data-destination-text="waveValue">Not available</strong>', markup)
        markup = re.sub(r'<p id="destination-(clarity|current)-note">.*?</p>', '<p data-destination-text="genericConditionNote">No sourced destination-level data</p>', markup)
        markup = markup.replace('data-destination-text="waveNote">No wave data in source', 'data-destination-text="genericConditionNote">No sourced destination-level data')
        markup = re.sub(r'<p><span data-destination-text="sourceIntro">.*?</p>', '<p data-destination-text="genericSources">Site profiles come from existing DiveAtlas records. No sourced destination-level seasonal data is available. Confirm conditions with a local guide.</p>', markup, flags=re.S)
        markup = markup.replace('data-destination-text="selected">Selected dive sites', 'data-destination-text="starting">A starting selection')
        markup = markup.replace('data-destination-text="selection">Selected for contrasting recorded features. Confirm suitability with a local guide.', 'data-destination-text="genericSelection">Automatically selected for recorded feature variety, not quality or suitability. Confirm with a local guide.')
        markup = markup.replace('Raja Ampat coastline and nearby places.', escape(region) + ' coastline and nearby places.')
        markup = markup.replace('Raja Ampat location map', escape(region, quote=True) + ' location map')
        markup = markup.replace('Explore Raja Ampat on the main map', 'Explore ' + escape(region, quote=True) + ' on the main map')
    return markup
