"""Serve source files with the same HTML upgrades as the publication build.

Usage: python -m tools.serve_local_preview --port 8796
No source HTML is rewritten; existing permalink snapshots remain intact.
"""
import argparse
import io
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .site_header_assets import install_shared_header_assets

ROOT = Path(__file__).resolve().parents[1]


class PreviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        target = Path(self.translate_path(self.path))
        if target.is_dir():
            target = target / 'index.html'
        if target.is_file() and target.suffix == '.html':
            data = install_shared_header_assets(target.read_text(encoding='utf-8'), '0.0.1').encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return io.BytesIO(data)
        return super().send_head()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8796)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(PreviewHandler, directory=str(ROOT)))
    print(f'Local preview: http://127.0.0.1:{args.port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
