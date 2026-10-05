import gzip
import importlib.util
import json
import threading
import tempfile
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/tides/stage_static_release.py"
SPEC = importlib.util.spec_from_file_location("tide_release_stage", MODULE_PATH)
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)
HTTP_MODULE_PATH = ROOT / "tools/tides/verify_http_release.py"
HTTP_SPEC = importlib.util.spec_from_file_location("tide_http_release", HTTP_MODULE_PATH)
http_release = importlib.util.module_from_spec(HTTP_SPEC)
HTTP_SPEC.loader.exec_module(http_release)


class TideReleaseManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        families = {
            "eot20-v1": {"version": "eot20-v1", "model": "EOT20", "gridResolutionDegrees": 0.125},
            "eot20-viz-v1": {"version": "eot20-viz-v1", "assetCount": 1},
            "timezones-2026d": {"version": "timezones-2026d"},
        }
        for family, metadata in families.items():
            directory = self.source / family
            directory.mkdir(parents=True)
            (directory / "manifest.json").write_text(json.dumps(metadata), encoding="utf-8")
            if family == "timezones-2026d":
                payload = gzip.compress(b'{"features":[]}')
                (directory / "0_0.json.gz").write_bytes(payload)
            else:
                (directory / "0_0.bin.gz").write_bytes(gzip.compress(b"tide-chunk"))

    def tearDown(self):
        self.temp.cleanup()

    def test_manifest_inventory_is_deterministic_and_verifies_staged_files(self):
        generated_at = "2026-10-03T00:00:00Z"
        manifest = stage.build_manifest(self.source, "2026-10-03", generated_at)
        second = stage.build_manifest(self.source, "2026-10-03", generated_at)
        self.assertEqual(manifest, second)
        self.assertEqual(manifest["release"], "2026-10-03")
        self.assertEqual(manifest["cacheControl"], "public, max-age=31536000, immutable")

        release = self.root / "release"
        (release / "tides").parent.mkdir(parents=True)
        import shutil

        shutil.copytree(self.source, release / "tides")
        (release / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        verified = stage.verify_release(release)
        self.assertEqual(verified["inventorySha256"], manifest["inventorySha256"])
        self.assertEqual(verified["fileCount"], 6)

    def test_verification_rejects_mutated_asset(self):
        manifest = stage.build_manifest(self.source, "release-a", "2026-10-03T00:00:00Z")
        release = self.root / "release"
        (release / "tides").parent.mkdir(parents=True)
        import shutil

        shutil.copytree(self.source, release / "tides")
        (release / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (release / "tides/eot20-v1/0_0.bin.gz").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "failed integrity validation"):
            stage.verify_release(release)

    def test_release_id_rejects_path_components(self):
        for value in ("../release", "release/name", "", ".hidden"):
            with self.subTest(value=value):
                self.assertIsNone(stage.RELEASE_ID_RE.fullmatch(value))

    def test_local_http_smoke_checks_manifest_assets_headers_gzip_and_404(self):
        manifest = stage.build_manifest(self.source, "release-a", "2026-10-03T00:00:00Z")
        root = self.root / "public"
        release = root / "tides/release-a"
        (release / "tides").parent.mkdir(parents=True)
        import shutil

        shutil.copytree(self.source, release / "tides")
        (release / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

        class Handler(SimpleHTTPRequestHandler):
            def end_headers(self):
                self.send_header("Access-Control-Allow-Origin", "https://diveatlas.example")
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                super().end_headers()

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(root)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            result = http_release.run_http_smoke(
                f"http://127.0.0.1:{port}/tides/release-a/tides/",
                "https://diveatlas.example",
            )
            self.assertTrue(result["allChecksPassed"])
            self.assertEqual(result["missingAssetStatus"], 404)
            self.assertEqual(len(result["representativeAssets"]), 6)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
