# Terrain Z9/Z10 demo

This standalone sample contains only DiveAtlas Terrain palette atlases for the Palau area (132°E–135°E, 6°N–9°N). It has 8×8 tile atlases for Z9 and Z10 using the production Terrain v3 slope classifier and colors. The PNG atlas filename layout is `{zoom}/{atlasX}/{atlasY}.png`.

The production map still stops Terrain at Z8. This folder is a bounded demo for reviewing extra zoom levels and measuring storage; it does not change Bathymetry, contours, or the production Terrain manifest.

The source is GEBCO's 15-arc-second grid. Z9/Z10 pixels are resampled from that source and therefore show overzoomed display detail, not higher-resolution seabed measurements. See `manifest.json` for measured bytes, atlas coordinates, and the global storage estimate.
