# Totoro museum refinement — local verification

Implemented suggestions 1, 2, 3, 4, 6 and 7. Local preview: http://localhost:3001/. No deployment was performed.

The opening camera retains its radius and target at a 25° azimuth. Existing fill and ambient lighting are reduced, with a stronger rim. The runtime presentation table keeps the skeleton central, separates coat and muscle assemblies, groups attached heart/brain structures, and moves large networks behind the organs. Authored GLBs remain byte-for-byte unchanged. The default separation remains 65%.

The reveal uses the existing render loop and easing, with coat at 0–400 ms, muscles at 150–650 ms, organs/networks at 275–900 ms, and camera settlement at 1150 ms. Slider retargets start at current positions and finish in 300 ms without replaying the stagger. Paused/reduced-motion destinations are immediate. Camera input, mode changes and Reset cancel the appropriate sequence.

“Explore the brain” appears above variant controls in Split and Exploded. It shares explicit loading, caching, retry and cancellation with contextual entry, bypasses proximity only for the shortcut, and restores the initiating button's focus. Pending loads are serialized so stale completion cannot unload a newer session.

The opening sculpture clears the mode selector by approximately 27 px at 1280×720; larger tested viewports and both mobile sizes have more clearance. The exterior interaction hint has its own row, and the decorative edition caption is hidden below 700 px. The 1100×1100 poster is 94,542 bytes versus the original 100,824 bytes.

## Frame-time evidence

Same in-app browser and local Mac, viewport 1280×720, DPR 1, daylight, animation enabled, default camera per mode, all anatomy systems and male variant. Each sample is a separate warmed 180-frame window from the existing development RAF telemetry. Three windows were collected per mode before and after. The table uses the median across those three windows. Raw samples are in [frame-times.json](frame-times.json).

| Scene | Median ms, before → after | p95 ms, before → after | Triangles / draw calls, unchanged |
|---|---:|---:|---:|
| Exterior | 10.0 → 10.0 | 11.0 → 10.9 | 327,211 / 62 |
| Split | 10.7 → 10.5 | 20.8 → 20.7 | 1,331,505 / 755 |
| Exploded | 10.8 → 10.1 | 20.8 → 20.1 | 820,463 / 446 |
| Brain | 19.4 → 10.0 | 20.9 → 10.9 | 363,544 / 120 |

No repeatable median or p95 regression over 3% was identified. A later Split timing shift was investigated using an isolated checkout of the original HEAD on localhost:3002: its three median samples were 19.7, 19.2, 19.1 ms, versus 19.2, 19.1, 19.0 ms in the refined scene; p95 medians were 20.9 and 20.8 ms. This reproduces the timing shift in the original scene. RAF pacing varied between roughly 10 and 20 ms, so lower figures should not be interpreted as a proven GPU speedup.

Anatomy and brain canvas dimensions are unchanged. The exterior canvas height changes from 537 to 422 px to reserve the requested interface spacing; camera distance, pixel-ratio limits and rendering quality settings are unchanged. This exterior framing change prevents a pixel-for-pixel raster-cost comparison. Measurements cover this browser/hardware session, not every device or production GPU timings.

## Checks

- Anatomy runtime: 113 assertions, including exact reassembly, phased reveal, camera interruption, slider continuity, mode cancellation, and matching 30/60/120 Hz outcomes.
- Brain view: 107 assertions, including hidden/clipped shortcut entry in both modes, zero detail fetches before explicit activation, failure/retry, caching, camera/settings restoration, reset/mode/filter/variant/disposal cancellation, and stale-load reopening races.
- Presentation checks use real GLB group/part metadata and verify tissue presets preserve material classes, maps and transmission inputs.
- Existing brain material, activity (24 checks), touch (26 checks), character motion and split shadow-cache verification passed.
- TypeScript, targeted Oxlint and production build passed. Build retains the existing large-chunk advisory.
- Browser review covered 1280×720, 1440×900, 390×844 and 360×780, daylight/moonlight, both anatomy variants, selected brain, direct entry with hidden organs, return focus, and the application's fullscreen state. Native fullscreen capture in the embedded browser has scaling limitations.

## Scope of concurrent changes

Separate heart-material work appeared in the shared workspace during this implementation, including `createHeartTissueMaterial` and a heart-specific selection tint. Those edits and their review images were preserved. The performance samples include the final shared workspace. The preset-table changes in this plan add no shader features; the separate heart shader is outside that claim and outside this plan's original material-class constraint.

## Before and after

[Open visual comparison](comparison.html). The Split, Exploded and Brain before views were captured before implementation. The exterior before view was captured later from the isolated original HEAD using the same viewport.

- [Exterior before](before-exterior.png) · [Exterior after](after-exterior.png)
- [Split before](before-split.png) · [Split after](after-split.png)
- [Exploded before](before-exploded.png) · [Exploded after](after-exploded.png)
- [Brain before](before-brain.png) · [Brain after](after-brain.png)

Original model SHA-256 values, unchanged after implementation:

- totoro.glb: `5f4f933e6955149b63a42399df196597d698eea8d3ad98fcbbabf0e8b3f439ea`
- totoro-anatomy.glb: `d9331d7b9ca5ccbcebf56dd49b8d0e110a5a65d33493c6fc5af41f8c43d0db2b`
