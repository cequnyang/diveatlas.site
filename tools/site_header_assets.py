"""Install the shared header on every published HTML entry point."""

import re
from html import escape


def site_header_fallback() -> str:
    """Useful without JavaScript; the runtime expands it into the full header."""
    return ('<header class="site-header"><a class="brand" href="/" aria-label="DiveAtlas home">'
            '<img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a>'
            '<div class="top-menu-version" data-version="0.0.1" aria-label="DiveAtlas version 0.0.1" hidden>v0.0.1</div></header>')


def shared_header_assets(version: str | None = None) -> str:
    release = f' data-app-version="{escape(version, quote=True)}"' if version else ''
    return ('<link rel="stylesheet" href="/assets/site-header.css?v=13">\n'
            '<link rel="stylesheet" href="/assets/search-results-menu.css?v=33">\n'
            f'<script src="/js/site-header.js?v=7"{release} defer></script>\n')


def install_initial_detail_appearance(markup: str) -> str:
    """Give recorded permalinks their final geometry before any script runs.

    Preserve record content and existing action nodes. The runtime still owns
    photo preview, rating, translation and the recommendation explorer.
    """
    if not re.search(r'<main\b[^>]*data-site-id=', markup):
        return markup
    markup = re.sub(r'(<body\b[^>]*class=")([^"]*)(")',
                    lambda m: m[1] + (m[2] if 'cinematic-pilot' in m[2].split() else m[2] + ' cinematic-pilot') + m[3], markup, count=1)
    markup = re.sub(r'<main\b[^>]*data-site-id=[^>]*>',
                    lambda m: m[0] if re.search(r'\sid=', m[0]) else m[0].replace('<main', '<main id="detailPage"', 1), markup, count=1)
    if '/assets/dive-site-cinematic-pilot.css' not in markup:
        markup = markup.replace('</head>', '<link rel="stylesheet" href="/assets/dive-site-cinematic-pilot.css?v=118">\n</head>', 1)
    else:
        markup = re.sub(r'(/assets/dive-site-cinematic-pilot\.css)\?v=\d+', r'\1?v=118', markup)
    rail = re.search(r'<aside\b[^>]*class="site-photo-gallery-rail[^\"]*"[^>]*>.*?</aside>', markup, re.S)
    hero = re.search(r'<section\b[^>]*class="site-hero"[^>]*>.*?</section>', markup, re.S)
    if rail and hero and rail.start() < hero.end():
        rail_markup = rail[0].replace('class="site-photo-gallery-rail"', 'class="site-photo-gallery-rail cinematic-pilot__rail"')
        markup = markup[:rail.start()] + markup[rail.end():]
        markup = re.sub(r'(<section\b[^>]*class="site-hero"[^>]*>.*?</section>)',
                        lambda m: m[0] + '\n' + rail_markup, markup, count=1, flags=re.S)
    def eager_hero(match):
        image = re.sub(r'\sloading="lazy"', ' loading="eager"', match[2])
        if 'fetchpriority=' not in image:
            image = image[:-1] + ' fetchpriority="high">'
        return match[1] + image
    # Only the hero image gets priority; recommendation thumbnails stay lazy.
    markup = re.sub(r'(<button\b[^>]*class="site-photo-preview-trigger"[^>]*>)(<img\b[^>]*>)',
                    eager_hero, markup, count=1)
    if 'class="site-photo-preview-trigger"' not in markup:
        markup = markup.replace('class="site-hero"', 'class="site-hero cinematic-pilot--no-photo"', 1)
    return markup


def install_shared_header_assets(markup: str, version: str) -> str:
    """Cover legacy and future pages without rewriting generated source trees."""
    markup = install_initial_detail_appearance(markup)
    # Replace only our tags so repeated assembly is idempotent and carries the
    # current release into pages that never had a version label in their HTML.
    markup = re.sub(r'<link\b[^>]*href=["\']/assets/site-header\.css[^"\']*["\'][^>]*>\s*', '', markup)
    markup = re.sub(r'<link\b[^>]*href=["\']/?assets/search-results-menu\.css[^"\']*["\'][^>]*>\s*', '', markup)
    markup = re.sub(r'<script\b[^>]*src=["\']/js/site-header\.js[^"\']*["\'][^>]*>\s*</script>\s*', '', markup)
    # Cached generated trees must use the current renderer/controller contract
    # too; retaining the old renderer could replace newly bound header nodes.
    markup = re.sub(r'<script\b[^>]*src=["\']/js/seo-browse-header\.js[^"\']*["\'][^>]*>\s*</script>\s*', '', markup)
    markup = re.sub(r'(/js/seo-page-controls\.js)\?v=\d+', r'\1?v=38', markup)
    markup = re.sub(r'(/assets/seo\.css)\?v=\d+', r'\1?v=207', markup)
    markup = re.sub(r'(/js/dive-conditions-chart\.js)\?v=\d+', r'\1?v=56', markup)
    markup = re.sub(r'(/js/seo-site-search\.js)\?v=\d+', r'\1?v=43', markup)
    markup = re.sub(r'(/assets/seo-site-search\.css)\?v=\d+', r'\1?v=13', markup)
    markup = re.sub(r'(/datasets/dive-site-name-translations\.js)\?v=\d+', r'\1?v=2', markup)
    assets = shared_header_assets(version)
    if re.search(r'</head\s*>', markup, flags=re.I):
        return re.sub(r'</head\s*>', lambda match: assets + match.group(), markup, count=1, flags=re.I)
    # Some small legacy documents omit head/body tags; browsers still create
    # them. Insert after html so the shared bootstrap remains a head asset.
    return re.sub(r'(<html\b[^>]*>)\s*', lambda match: match.group(1) + '\n' + assets, markup, count=1, flags=re.I) if re.search(r'<html\b', markup, re.I) else assets + markup
