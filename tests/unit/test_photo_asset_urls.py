import json,tempfile,unittest
from pathlib import Path
from tools.photo_asset_urls import photo_asset_url,migrated_photo_paths,photo_asset_available,photo_asset_size,photo_asset_sha256,write_storage_ignores

class PhotoAssetURLTests(unittest.TestCase):
 def test_clean_checkout_uses_verified_manifest_without_backup(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'datasets').mkdir();src='/assets/dive-sites/example/hero.jpg';digest='c'*64;url='https://assets.diveatlas.site/site-photos/v1/'+digest+'.jpg'
   (root/'datasets/dive-site-photo-r2.json').write_text(json.dumps({'assets':{src:{'url':url,'sha256':digest,'bytes':1234}}}),'utf8')
   self.assertFalse((root/src.lstrip('/')).exists())
   self.assertTrue(photo_asset_available(root,src));self.assertEqual(photo_asset_size(root,src),1234);self.assertEqual(photo_asset_sha256(root,src),digest)
   self.assertFalse(photo_asset_available(root,'/assets/dive-sites/unuploaded/hero.jpg'))
   with self.assertRaises(FileNotFoundError):photo_asset_size(root,'/assets/dive-sites/unuploaded/hero.jpg')
   write_storage_ignores(root);self.assertIn('/example/hero.jpg',(root/'assets/dive-sites/.gitignore').read_text('utf8'))
 def test_verified_mapping_fallback_and_remote_idempotence(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'datasets').mkdir();src='/assets/dive-sites/example/hero.jpg';digest='a'*64
   url='https://assets.diveatlas.site/site-photos/v1/'+digest+'.jpg'
   (root/'datasets/dive-site-photo-r2.json').write_text(json.dumps({'assets':{src:{'url':url,'sha256':digest}}}),'utf8')
   self.assertEqual(photo_asset_url(root,src),url)
   self.assertEqual(photo_asset_url(root,src.lstrip('/')),url)
   self.assertEqual(photo_asset_url(root,url),url)
   self.assertEqual(photo_asset_url(root,'/held/hero.jpg'),'/held/hero.jpg')
   self.assertEqual(migrated_photo_paths(root),{src})
 def test_missing_or_disabled_map_uses_local_copy(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);self.assertEqual(photo_asset_url(root,'/local.jpg'),'/local.jpg')
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'datasets').mkdir();(root/'datasets/dive-site-photo-r2.json').write_text('{"enabled":false,"assets":{}}','utf8')
   self.assertEqual(photo_asset_url(root,'/local.jpg'),'/local.jpg')
 def test_rejects_unexpected_host_or_local_traversal(self):
  for src,url in [('/assets/dive-sites/x/hero.jpg','https://elsewhere.example/a.jpg'),('/assets/dive-sites/../secret.jpg','https://assets.diveatlas.site/site-photos/v1/'+'a'*64+'.jpg')]:
   with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);(root/'datasets').mkdir();(root/'datasets/dive-site-photo-r2.json').write_text(json.dumps({'assets':{src:{'url':url,'sha256':'a'*64}}}),'utf8')
    with self.assertRaises(ValueError):photo_asset_url(root,src)

 def test_explicit_hold_keeps_transport_local(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'datasets').mkdir();src='/assets/dive-sites/held/hero.jpg';digest='b'*64
   (root/'datasets/dive-site-photo-r2.json').write_text(json.dumps({'assets':{src:{'sha256':digest,'url':'https://assets.diveatlas.site/site-photos/v1/'+digest+'.jpg'}},'held':{src:{'reason':'Unresolved attribution'}}}),'utf8')
   self.assertEqual(photo_asset_url(root,src),src)
   self.assertEqual(migrated_photo_paths(root),set())

if __name__=='__main__':unittest.main()
