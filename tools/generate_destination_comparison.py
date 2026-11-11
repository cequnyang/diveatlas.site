"""Build the comparison entry point from the site's existing shell and components."""

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.generate_seo_pages import page_shell, site_footer_markup
from tools.site_header_assets import site_header_fallback


def build():
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    options = "".join(f'<option value="{i}"{" selected" if i == 9 else ""}>{name}</option>' for i, name in enumerate(months, 1))
    # The comparison dictionary owns changing UI copy; recorded names and
    # interpolated translations must not be reinterpreted by the detail walker.
    body = f'''{site_header_fallback()}
<main class="detail-page" id="detailPage" data-detail-scroll data-i18n-ignore>
<div class="destination-season-panel comparison-panel">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Map</a><span aria-hidden="true">/</span><a href="/regions/">Regions</a><span aria-hidden="true">/</span><span>Compare destinations</span></nav>
  <div class="comparison-heading"><div><h1 id="comparisonTitle">Compare destinations</h1>
  <p class="destination-lead">Compare historical environmental data across all mapped site records, then explore the diving in each destination.</p></div>
  <div class="site-tools comparison-units" role="group" aria-label="Comparison units">
    <span id="seoLengthUnitSwitch" role="group" aria-label="Length unit"><button class="seo-secondary-button" data-length-unit="m" aria-pressed="true" type="button">m</button><button class="seo-secondary-button" data-length-unit="ft" aria-pressed="false" type="button">ft</button></span>
    <span id="seoTemperatureUnitSwitch" role="group" aria-label="Temperature unit"><button class="seo-secondary-button" data-temperature-unit="C" aria-pressed="true" type="button">°C</button><button class="seo-secondary-button" data-temperature-unit="F" aria-pressed="false" type="button">°F</button></span>
  </div></div>
  <section class="detail-section comparison-controls" aria-label="Choose destinations"><div class="destination-month-control comparison-month"><label class="sr-only" for="comparisonMonth">Planning month · both destinations</label><div><select id="comparisonMonth" data-scroll-wheel>{options}</select></div></div><div class="comparison-destination-controls"><div class="comparison-selector-row"><ul class="site-list comparison-selectors">
    <li><div><label class="sr-only" id="comparisonLeftLabel" for="comparisonLeftSearch">First destination</label><div><select id="comparisonLeft" aria-labelledby="comparisonLeftLabel" disabled><option data-comparison-text="loading">Loading…</option></select></div></div></li>
    <li><div><label class="sr-only" id="comparisonRightLabel" for="comparisonRightSearch">Second destination</label><div><select id="comparisonRight" aria-labelledby="comparisonRightLabel" disabled><option data-comparison-text="loading">Loading…</option></select></div></div></li>
  </ul><button id="comparisonSwap" class="seo-secondary-button comparison-swap" type="button" aria-label="Swap destinations" data-comparison-aria="swap" disabled><span aria-hidden="true">⇄</span></button></div><p class="monthly-conditions-status sr-only" id="comparisonSelectionStatus" role="status"></p>
      <h2 id="comparisonMonthTitle" class="sr-only">September</h2><p hidden class="destination-source" id="comparisonSeason">Local conditions vary by destination, site, depth and tide.</p><p class="monthly-conditions-status" id="comparisonStatus" role="status">Loading the public site index and environmental data…</p><div id="comparisonRetryContainer" hidden><button class="seo-secondary-button" id="comparisonRetry" type="button">Retry data requests</button></div>
    </div>
  </section>
  <noscript><p>Enable JavaScript to query the environmental comparison. <a href="/regions/indonesia/bali/">Explore Bali</a> or <a href="/regions/indonesia/komodo-national-park/">explore Komodo</a>.</p></noscript>
  <section class="detail-section comparison-overview" hidden aria-labelledby="comparisonCoverageTitle"><h2 id="comparisonCoverageTitle">Destinations &amp; data coverage</h2><ul class="site-list" id="comparisonDestinations"></ul></section>
  <div id="comparisonMetrics" aria-busy="true"></div>
</div>
  <section class="detail-section record-evidence" aria-labelledby="comparisonEvidenceTitle">
    <details><summary><span class="note-icon" aria-hidden="true"></span><span class="record-evidence-action" id="comparisonEvidenceTitle">Sources &amp; limitations</span></summary>
    <p class="record-evidence-summary" data-comparison-text="preferenceNote"></p>
    <div id="comparisonPhotoCredits"></div>
    <p class="record-evidence-summary" data-comparison-text="rangeNote"></p>
    <h3>How coverage is calculated</h3><p data-comparison-text="scopeNote"></p><p data-comparison-text="coverageNote"></p>
    <h3>Environmental data and source periods</h3><ul>
      <li><a href="/data/temperature/query/v2/metadata.json">WOA23 · <span data-comparison-text="temperature"></span></a>: 1991–2020 · 0.25° · 5 m</li>
      <li><a href="/data/water_clarity/query/v2/metadata.json">Copernicus · <span data-comparison-text="clarity"></span></a>: 2016–2025 · 4 km. <span data-comparison-text="clarityNote"></span></li>
      <li><a href="/data/currents/metadata.json">Copernicus · <span data-comparison-text="current"></span></a>: 1993–2016 · 10 m (~9.57 m) · ~37 km. <span data-comparison-text="currentMeasureNote"></span></li>
      <li><a href="/data/waves/metadata.json">Copernicus · <span data-comparison-text="waves"></span></a>: 1993–2020 · 0.2°. <span data-comparison-text="wavesNote"></span></li>
    </ul><p data-comparison-text="methodsNote"></p><p>Generated using E.U. Copernicus Marine Service Information. DOI: 10.48670/moi-00021; 10.48670/moi-00022.</p>
    <h3>Why current coverage can be limited</h3><p data-comparison-text="currentNote"></p>
    <div id="comparisonPairGuidance" hidden><h3>Bali / Komodo guidance and local conditions</h3><p data-comparison-text="guidanceNote"></p><p><a href="https://www.padi.com/diving-in/bali/">PADI Bali</a> · <a href="https://www.padi.com/diving-in/komodo/">PADI Komodo</a></p></div><p id="comparisonGenericGuidance" data-comparison-text="seasonGeneric"></p></details>
  </section>
</main>
{site_footer_markup()}
<script src="/js/scroll-wheel.js?v=3" defer></script>
'''
    # Reuse the reviewed destination-page photos and their complete license
    # captions. Missing assignments stay image-free rather than borrowing a
    # photo from a different place with the same name.
    photos = {}
    destination_paths = {}
    assignments = json.loads((ROOT / 'datasets/destination-photo-assignments.json').read_text(encoding='utf-8'))
    for entry in assignments['entries']:
        page = ROOT / entry['path'].strip('/') / 'index.html'
        if not page.exists():
            continue
        destination_paths[entry['areaKey']] = entry['path']
        source = page.read_text(encoding='utf-8')
        image = re.search(r'<div class="site-photo-preview-trigger">(<img[^>]+>)', source)
        caption = re.search(r'<figcaption class="destination-photo-caption">(.*?)</figcaption>', source, re.S)
        if image and caption:
            photos[entry['areaKey']] = '<figure class="comparison-destination-photo"><div class="comparison-photo-scene">' + image[1].replace('loading="eager"', 'loading="lazy"').replace('fetchpriority="high"', '') + '</div><figcaption>' + caption[1] + '</figcaption></figure>'
    body += '<script type="application/json" id="comparisonDestinationPaths">' + json.dumps(destination_paths).replace('<', '\\u003c') + '</script>'
    body += '<script type="application/json" id="comparisonPhotos">' + json.dumps(photos, ensure_ascii=False).replace('<', '\\u003c') + '</script>'
    body = re.sub(r'<summary>([^<]+)</summary>', r'<summary><span class="note-icon" aria-hidden="true"></span><span class="record-evidence-action">\1</span></summary>', body)
    dictionary = (ROOT / 'js' / 'destination-comparison-i18n.js').read_text(encoding='utf-8')
    translations, _ = json.JSONDecoder().raw_decode(dictionary.split('const copy = ', 1)[1])
    body = re.sub(r'(<(?:p|span)[^>]*data-comparison-text="([^"]+)"[^>]*>)(</(?:p|span)>)', lambda m: m[1] + translations['en'][m[2]].replace('&', '&amp;') + m[3], body)
    static_keys = ['menu', 'lead', 'first', 'second', 'planning', 'wheel', 'historical', 'retry', 'loadingIndex', 'coverageTitle', 'sourcesTitle', 'scopeTitle', 'methodsTitle', 'currentTitle', 'guidanceTitle', 'map', 'regions']
    for key in static_keys:
        source = translations['en'][key].replace('&', '&amp;')
        body = body.replace('>' + source + '<', '><span data-comparison-text="' + key + '">' + source + '</span><')
    for key, label in [('breadcrumb', 'Breadcrumb'), ('units', 'Comparison units'), ('lengthUnit', 'Length unit'), ('temperatureUnit', 'Temperature unit'), ('choose', 'Choose destinations'), ('planning', 'Planning month')]:
        body = body.replace('aria-label="' + label + '"', 'aria-label="' + label + '" data-comparison-aria="' + key + '"')
    modules = ['area-search', 'search-results-menu', 'temperature-query', 'water-clarity-query', 'current-math', 'current-tile-cache', 'regional-currents', 'waves-view', 'dive-conditions-model', 'dive-conditions-service', 'destination-comparison-data', 'destination-comparison']
    # The normal shell owns data configuration, shared menus, units and search.
    # Keep this controller after those scripts, without introducing another shell.
    markup = page_shell('Compare destinations | DiveAtlas', 'Choose two dive destinations and compare historical environmental ranges and data coverage across their mapped dive-site records.', 'https://diveatlas.site/compare/', body, body_class='region-destination-page destination-comparison-page')
    # Match the existing evidence component's icon/text slots; plain text would
    # occupy its 16px icon column and wrap vertically.
    markup = re.sub(r'<summary>([^<]+)</summary>', r'<summary><span class="note-icon" aria-hidden="true"></span><span class="record-evidence-action">\1</span></summary>', markup)
    markup = markup.replace('</head>', '<link rel="stylesheet" href="/assets/scroll-wheel.css?v=1">\n<link rel="stylesheet" href="/assets/destination-overview.css?v=78">\n</head>')
    markup = markup.replace('</body>', ''.join(f'<script src="/js/{name}.js?v={24 if name in ["destination-comparison", "destination-comparison-data"]  else 1}" defer></script>\n' for name in modules) + '</body>')
    output = ROOT / 'compare' / 'index.html'
    output.parent.mkdir(exist_ok=True)
    output.write_text(markup, encoding='utf-8', newline='\n')
    return output


if __name__ == '__main__':
    print(build())
