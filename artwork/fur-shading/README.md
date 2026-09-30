# Fur shading: before and after

This pass changes how the coat is lit and textured (`lib/fur-material.ts`). The model, poster and download are unchanged. "Before" is the coat merged in PR #4 (`47058dd`); "after" is this branch. Captures come from the real gallery in headless Chromium with ANGLE SwiftShader at 1280 × 900 and DPR 1, with the same camera for each pair.

| View | Before | After |
|---|---|---|
| Gallery | [before-default](before-default.webp) | [after-default](after-default.webp) |
| Closest zoom | [before-nearest](before-nearest.webp) | [after-nearest](after-nearest.webp) |
| Profile | [before-profile](before-profile.webp) | [after-profile](after-profile.webp) |
| Moonlight | [before-night](before-night.webp) | [after-night](after-night.webp) |
| Cheek, 1:1 | [before-closeup](before-closeup.webp) | [after-closeup](after-closeup.webp) |

Before, the skin between strands read as smooth clay with painted streaks, and about half the strands were lit as if they faced into the body. After, the whole surface reads as dense fur: fine hairs, locks and partings, highlights that run along the groom, and rim light at the outline.

## Cost

All numbers are frame times from a CPU rasterizer and are relative checks only; [measurements.json](measurements.json) has the method and raw medians. SwiftShader filters textures in software, which penalizes the new skin's two 3D texture reads far more than a GPU would.

Swapping old and new coat materials on the same meshes in one page:

| Full frame | Before | After | After, no texture reads | After, old BRDF |
|---|---:|---:|---:|---:|
| Gallery view | 1,344 ms | 1,391 ms (+3.5%) | 1,333 ms (−0.8%) | 1,345 ms (+0.1%) |
| Closest zoom | 1,743 ms | 1,780 ms (+2.1%) | 1,719 ms (−1.4%) | 1,696 ms (−2.7%) |

The fur lighting costs about the same as the physical BRDF with sheen that it replaces. The extra time is the two reads of the noise volume, which replace three procedural noises (24 hash evaluations) that ran on the shader cores. On graphics hardware those reads go to the texture units, so the GPU cost is likely no higher than before. It has not been measured.

Against the coat before both fur passes (`9a087ee`: 324,967 triangles, 4,844,876-byte model), full frames are faster: 1,520 → 1,395 ms (−8.3%) at the gallery view and 1,850 → 1,747 ms (−5.5%) at the closest zoom. With the plinth, atmosphere and soot sprites hidden, the change is −9.9% and −6.9%. The new coat was faster in every paired round.

The noise volume adds about 1.2 MB of GPU memory and no download.

## Method notes

- The HDR pipeline leaves its multisampled target bound for reading. A `readPixels` from it fails with `INVALID_OPERATION` without waiting, and `gl.finish()` does not block in this setup either, so timings taken that way measure almost nothing. Bind the default framebuffer for the readback, then restore the binding.
- Keep Vite's hot updates out of benchmark pages. An edit mid-run re-runs React effects and rebuilds the scene.
- A run of the same build against itself varied by 2–5% per configuration, with occasional larger outliers, so the comparisons above use paired or alternating runs and medians.
