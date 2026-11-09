"""Ignore generated page chrome, never policy prose, destinations or revisions.

Raw HTML hashes remain provenance. MediaWiki embeds request/server/cache values
outside its article; those bytes are unsuitable as a policy-change detector.
"""
import datetime
import hashlib
import json
import re
import urllib.parse
from bs4 import BeautifulSoup, Comment

VERSION = 'wikimedia-policy-content-v1'

def fingerprint(body, source_url):
    text = body.decode('utf-8-sig')
    soup = BeautifulSoup(text, 'html.parser')
    articles = soup.select('.mw-parser-output')
    if len(articles) != 1:
        raise ValueError('Policy article missing or ambiguous; manual review required')
    article = articles[0]
    revisions = set(re.findall(r'"wgRevisionId"\s*:\s*(\d+)', text))
    if len(revisions) != 1:
        raise ValueError('Policy revision identity missing or ambiguous')
    for node in article.find_all(string=lambda value: isinstance(value, Comment)):
        node.extract()
    for node in article.select('script, style'):
        node.decompose()
    prose = ' '.join(article.get_text(' ', strip=True).split())
    if len(prose) < 100:
        raise ValueError('Policy article unexpectedly short')
    links = [[a.get_text(' ', strip=True), urllib.parse.urljoin(source_url, a['href'])]
             for a in article.find_all('a', href=True)]
    images = [[image.get('alt', ''), urllib.parse.urljoin(source_url, image.get('src', ''))]
              for image in article.find_all('img')]
    payload = {'text': prose, 'links': links, 'images': images,
               'revision': next(iter(revisions)), 'source_url': source_url}
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
    return {'version': VERSION, 'sha256': digest, 'revision': payload['revision'],
            'text_characters': len(prose), 'links': len(links), 'images': len(images)}

def verify(plan, probe, run_dir, baseline_path, required_urls):
    baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    if probe.get('user_agent') != baseline['user_agent']:
        raise ValueError('Policy client identity differs from reviewed baseline')
    age = (datetime.datetime.now(datetime.timezone.utc) -
           datetime.datetime.fromisoformat(probe['checked_at'])).total_seconds()
    if not 0 <= age <= 86400:
        raise ValueError('Policy evidence expired; no content dispatch')
    historical = {d['url']: d for d in baseline['documents']}
    current = {d['url']: d for d in probe['documents'] if d['status'] == 'retrieved'}
    results = []
    for url in required_urls:
        expected = plan['policy_baseline'].get(url)
        document = current.get(url)
        if not expected or not document:
            raise ValueError('Required policy unavailable: ' + url)
        actual = document.get('sha256')
        if actual == expected:
            results.append({'url': url, 'result': 'raw response hash unchanged', 'raw_sha256': actual})
            continue
        reference = historical.get(url, {})
        signature = reference.get('content_fingerprint')
        if reference.get('sha256') != expected or not signature or signature.get('version') != VERSION:
            raise ValueError('Changed policy response lacks a reviewed content baseline: ' + url)
        if not re.fullmatch(r'[a-f0-9]{64}', actual or ''):
            raise ValueError('Invalid policy response digest')
        path = run_dir / 'cache' / actual
        if not path.is_file():
            raise ValueError('Changed policy body not cached/permitted; manual review required: ' + url)
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != actual:
            raise ValueError('Cached policy body integrity failure: ' + url)
        observed = fingerprint(body, url)
        if observed != signature:
            raise ValueError('Policy article, links or revision changed; manual review required: ' + url)
        results.append({'url': url, 'result': 'generated HTML changed; article/links/revision identical',
                        'baseline_raw_sha256': expected, 'raw_sha256': actual,
                        'content_fingerprint': observed})
    return {'method': VERSION, 'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'network_requests': 0, 'documents': results,
            'limits': 'Robots/route/redirect/denial checks remain mandatory; this is not provider approval.'}
