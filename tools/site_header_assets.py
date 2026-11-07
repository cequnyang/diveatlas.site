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
    return ('<link rel="stylesheet" href="/assets/site-header.css?v=6">\n'
            f'<script src="/js/site-header.js?v=2"{release} defer></script>\n')


def install_shared_header_assets(markup: str, version: str) -> str:
    """Cover legacy and future pages without rewriting generated source trees."""
    # Replace only our tags so repeated assembly is idempotent and carries the
    # current release into pages that never had a version label in their HTML.
    markup = re.sub(r'<link\b[^>]*href=["\']/assets/site-header\.css[^"\']*["\'][^>]*>\s*', '', markup)
    markup = re.sub(r'<script\b[^>]*src=["\']/js/site-header\.js[^"\']*["\'][^>]*>\s*</script>\s*', '', markup)
    # Cached generated trees must use the current renderer/controller contract
    # too; retaining the old renderer could replace newly bound header nodes.
    markup = re.sub(r'<script\b[^>]*src=["\']/js/seo-browse-header\.js[^"\']*["\'][^>]*>\s*</script>\s*', '', markup)
    markup = re.sub(r'(/js/seo-page-controls\.js)\?v=\d+', r'\1?v=28', markup)
    markup = re.sub(r'(/assets/seo\.css)\?v=\d+', r'\1?v=207', markup)
    markup = re.sub(r'(/js/dive-conditions-chart\.js)\?v=\d+', r'\1?v=56', markup)
    markup = re.sub(r'(/js/seo-site-search\.js)\?v=\d+', r'\1?v=13', markup)
    assets = shared_header_assets(version)
    if re.search(r'</head\s*>', markup, flags=re.I):
        return re.sub(r'</head\s*>', lambda match: assets + match.group(), markup, count=1, flags=re.I)
    # Some small legacy documents omit head/body tags; browsers still create
    # them. Insert after html so the shared bootstrap remains a head asset.
    return re.sub(r'(<html\b[^>]*>)\s*', lambda match: match.group(1) + '\n' + assets, markup, count=1, flags=re.I) if re.search(r'<html\b', markup, re.I) else assets + markup
