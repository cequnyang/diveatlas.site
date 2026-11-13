"""A failed photo refresh must leave the last packaged site intact."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools import prepare_pages


class PhotoPackagingRefreshTests(unittest.TestCase):
    def test_refresh_failure_stops_before_replacing_packaged_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            output = root / '_site'
            output.mkdir()
            previous = output / 'previous-build.txt'
            previous.write_text('last successful build', encoding='utf-8')
            args = ['prepare_pages', '--data-asset-base-url', 'https://assets.example/releases/test/']
            with patch.object(prepare_pages, 'ROOT', root), \
                 patch.object(prepare_pages, 'normalize_app_version', return_value='0.0.1'), \
                 patch('sys.argv', args), \
                 patch('tools.refresh_detail_photos.refresh', side_effect=ValueError('invalid photo assignment')), \
                 patch.object(prepare_pages, 'tracked_and_untracked_site_files') as select_files:
                with self.assertRaisesRegex(ValueError, 'invalid photo assignment'):
                    prepare_pages.main()
                select_files.assert_not_called()
            self.assertEqual(previous.read_text(encoding='utf-8'), 'last successful build')
