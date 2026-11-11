"""Upload cached maps and publish their metadata for clean-checkout generation.

Run: python maintenance/upload_destination_maps_r2.py
Requires boto3 and the existing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET,
CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY environment vars.
No local files are deleted. Run before untracking assets/destination-maps.
"""
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://assets.diveatlas.site'
PREFIX = 'assets/destination-maps/'


def main():
    account = os.environ['CLOUDFLARE_ACCOUNT_ID']
    bucket = os.environ['CLOUDFLARE_R2_BUCKET']
    assert account == 'c0cbc007f637d7263a3be3b692b4dd63'
    assert bucket == 'diveatlas-site'
    client = boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com',
                          aws_access_key_id=os.environ['CLOUDFLARE_R2_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['CLOUDFLARE_R2_SECRET_ACCESS_KEY'],
                          region_name='auto', config=Config(max_pool_connections=4,
                          connect_timeout=15, read_timeout=60,
                          retries={'mode': 'standard', 'total_max_attempts': 3}))
    folder = ROOT / PREFIX
    files = sorted(folder.glob('*.png'))
    assert files, 'No cached maps found'

    def transfer(path):
        body = path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        key = PREFIX + path.name
        # Fingerprinted names are immutable: an existing different object must
        # stop migration rather than silently change a cached public image.
        try:
            client.put_object(Bucket=bucket, Key=key, Body=body, ContentType='image/png',
                              Metadata={'sha256': digest}, IfNoneMatch='*',
                              CacheControl='public,max-age=31536000,immutable')
        except ClientError as error:
            if str(error.response['Error']['Code']) not in ('PreconditionFailed', '412'):
                raise
        head = client.head_object(Bucket=bucket, Key=key)
        assert head['ContentLength'] == len(body)
        assert head['Metadata']['sha256'] == digest
        assert head['ContentType'] == 'image/png'
        request = Request(BASE + '/' + key, headers={
            'User-Agent': 'DiveAtlas-R2-Migration/1.0', 'Origin': 'https://diveatlas.site'})
        with urlopen(request, timeout=60) as response:
            assert hashlib.sha256(response.read()).hexdigest() == digest
        return {'url': BASE + '/' + key, 'sha256': digest, 'bytes': len(body)}

    assets = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for index, (path, record) in enumerate(zip(files, pool.map(transfer, files)), 1):
            assets['/' + PREFIX + path.name] = record
            if index % 50 == 0:
                print(f'Public bytes verified: {index}/{len(files)}', flush=True)
    manifests = {}
    for path in sorted(folder.glob('*.json')):
        manifest = json.loads(path.read_text('utf-8'))
        manifest['src'] = assets[manifest['src']]['url']
        manifests[path.stem] = manifest
    # Publish the registry only after every public download matches its source.
    registry = ROOT / 'datasets/destination-maps.json'
    temporary = registry.with_suffix('.json.tmp')
    temporary.write_text(json.dumps({'schema': 1, 'assets': assets, 'maps': manifests},
                                   ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(registry)
    print(f'Verified {len(assets)} images; published {len(manifests)} manifests', flush=True)


if __name__ == '__main__':
    main()
