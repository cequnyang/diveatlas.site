# Fractional wheel zoom investigation — 2026-10-17

Fractional wheel zoom exposed a Reef display-range gap: its raster branch used
`zoom <= 7`, while vector interaction began at `zoom >= 8`. At intermediate
levels the renderer unnecessarily created dense vector polygons. The expensive
work is geometry construction, projection, Canvas drawing, and allocation,
rather than arithmetic on floating-point zoom numbers.

The fix retains the existing Z7 raster source throughout `zoom < 8` and switches
to vectors at Z8. All five Reef rendering/snapshot/toggle conditions now use
that same boundary. Tile source zoom remains capped at 7.

The combined `moveend zoomend` handler also scheduled data before its existing
animation-frame coalescing. Local Coral refreshes synchronously, so both events
could rebuild it. Scheduling now happens inside the coalesced frame, with a
pending flag so a concurrent projection-only theme update cannot drop a data
refresh. No custom wheel handler was introduced.

## Measured evidence

Environment: Windows, Node v22.22.2, Playwright 1.63.0, bundled headless Chromium
153.0.8010.12; viewport 1280×900. Real startup/data loading remained enabled
(`__diveatlas_test` was absent). The local server was `tools/serve_test_site.js`
on port 8765. The requested layer set was `c,t,r,s,f,d` with view `i`.

After a 12-second startup wait, reset to latitude -5.7, longitude 131, Z7;
wait 2.5 seconds, then send 10 wheel events at -12 followed by 10 at +12,
with a requested 35ms wait between calls, and collect another 1.5 seconds.
Playwright's native wheel dispatch and rendering introduce additional elapsed
time; this is not a guaranteed 35ms hardware event stream.

The controlled comparison changed only the premature Reef threshold through
an in-memory HTML response rewrite. Both variants used the fixed coalescing,
fractional zoom, wheel sensitivity 90, and wheel debounce 40ms. Instrumentation
exposed the map and counted synchronous calls; no profiling code is shipped in
the application. Chrome's sampling profiler and Long Tasks observer collected
the remaining evidence.

| Measurement | Early-vector threshold | Fixed threshold |
| --- | ---: | ---: |
| Wheel inputs | 20 | 20 |
| Completed zooms | 12 | 15 |
| Reef vector geometry builds | 6 | 0 |
| Synchronous geometry construction time | 1,041.2 ms | 0 ms |
| Local Coral renders | 12 | 15 |
| Synchronous local Coral render time | 15.8 ms | 16.6 ms |
| Longest main-thread task | 922 ms | 60 ms |
| Sum of `max(task duration - 50ms, 0)` | 3,936 ms | 54 ms |
| Profile interval | 11,615 ms | 8,187 ms |
| Page errors | 0 | 0 |

Raw results: `wheel-threshold-before.json` and `wheel-threshold-after.json`.
The earlier exploratory 40-event profiles (`wheel-before.json` and
`wheel-after.json`) helped locate the bottleneck; their integer-vs-fractional
branches traverse different zoom ranges and are not the controlled comparison.
The exploratory after run also overlapped browser tests and should not be used
for a clean timing estimate.

These are single-run local headless measurements, not universal FPS or
real-device latency estimates. Native animation accepted different numbers of
completed zooms (ranges 7–7.287 before and 6.952–7.335 after), so the camera
trajectories are not identical. They remain within the affected range. The
threshold-only intervention eliminates premature vector construction and the
large stalls in this reproduction. It does not establish performance at every
zoom, on every device, or with every environmental view.

After the user reported that desktop still felt rougher than before, the final
wheel settings were returned to 120 pixels per level and 60ms batching. The map
now settles wheel zoom on integer levels; Leaflet still visually interpolates
the gesture, and pinch retains continuous movement while the fingers are down.
This restores the earlier mouse-wheel response while keeping integer `z`
serialization. The current browser checks pass at these settings. The profile
figures above isolate the Reef threshold fix under the more eager experimental
wheel settings; they do not measure the final wheel cadence against the old
integer build.

## Reproduce

With the local server running, execute sequentially without other browser
tests competing for CPU/GPU:

```powershell
node artifacts/profile-wheel.cjs artifacts/wheel-threshold-before.json --early-vector
node artifacts/profile-wheel.cjs artifacts/wheel-threshold-after.json
```

The diagnostic script rewrites only its browser response; it does not change
the source file. It explicitly reproduces 90px/40ms/fractional settings for the
recorded controlled experiment. The `--early-vector` option reconstructs the
faulty threshold while retaining the scheduling fix, to isolate the
threshold's contribution.

## Regression verification

14 targeted desktop/mobile Playwright tests passed, plus the interaction-policy
check and `git diff --check`. Coverage includes fractional wheel stops, zoom
limits, integer share URLs, Coral/Fish marker actions, Reef raster popups, popup
attachment, and selected touch gestures.

The Reef regression test uses the real checkbox change handler because the
fixture helper always adds a raster fallback and would hide the original bug.
It checks raster coverage at 7, 7.31, and 7.99, switching at 8, and returning to
7.31. This strengthened boundary test was rerun successfully after the batch.

Implementation and diagnostic artifacts were prepared with AI assistance;
the browser results above are executed measurements. No deployment was made.
