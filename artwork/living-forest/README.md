# Living forest — local verification

This pass upgrades the real-time graphics around the existing sculpture. Model assets, anatomy metadata and camera framing are unchanged. The rendering systems are described in the main README under “Living forest”.

- **Pipeline:** HDR 4× MSAA target with depth and stencil, mip-chain bloom, and an AgX composite with per-scene grades, vignette, lens fringing in the organ studies, grain and dithering. The canvas stays transparent.
- **Exterior:** komorebi canopy light, a procedural camphor-tree plinth, sunbeams and moonbeams, depth-of-field dust, falling camphor leaves, fireflies that light the fur, and soot sprites that react to the pointer and to taps.
- **Rain:** streaks with impact splashes, wet wood with raindrop ripples, damp fur, overcast lighting and a sheltering colony of soot sprites. Rain is off by default.
- **Night sky:** stars and a moon glow in the page background, plus a warm sun glow by day.
- **Anatomy:** lit section rims and cap mottling in Split, and grades for the organ studies.

## Frame-rate evidence

This container has no GPU. The browser checks ran in headless Chromium 141 with ANGLE SwiftShader, a CPU software renderer, at 1440 × 900 and DPR 1. The original commit ran from an isolated worktree on another port, and both sides were counted over the same fixed windows. Raw figures are in [frame-rates.json](frame-rates.json).

| Scene | Before, fps | After, fps |
|---|---:|---:|
| Exterior | 1.91 | 1.35 |
| Split | 0.20 | 0.15 |

SwiftShader emulates multisampling and half-float targets on the CPU, so these ratios overstate the relative cost on graphics hardware. They show that the added work is bounded; they are not frame rates for any device. Hardware GPU timings were not measured.

On slow devices, the existing adaptive pixel ratio still steps down after sustained slow frames. If frames stay slow at the lowest ratio, the pipeline now halves multisampling once. A throwaway context checks float render-target support before the renderer is created, and the real multisampled framebuffer is checked at startup. Unsupported devices fall back to direct rendering with native antialiasing.

## Checks

- All twelve node verification suites pass: motion, presentation, split shadow cache, anatomy runtime, brain view, activity, touch and material, heart, eye, lung, and back muscles.
- TypeScript, Oxlint on `lib/` and `app/`, and the production build pass.
- Browser review:
  - Daylight, moonlight, and rain by day and by night.
  - Split, Exploded, and all four organ studies, with no console errors.
  - 390 × 844 with no horizontal overflow.
  - Live resizing through 1000 × 700, 390 × 844 and 1700 × 1000.
  - Reduced motion (still scene, idle render loop), soot-sprite scattering, and the tap reaction.
  - The forced direct-render fallback.
- Split section caps still render through the stencil passes inside the multisampled HDR target.

## Before and after

[Open visual comparison](comparison.html). Before views come from the original commit, and after views from this branch, in the same environment. Rain, the close-ups and the phone capture show new features and have no before view.

- [Daylight before](before-exterior-day.webp) · [Daylight after](after-exterior-day.webp)
- [Moonlight before](before-exterior-night.webp) · [Moonlight after](after-exterior-night.webp)
- [Split before](before-split.webp) · [Split after](after-split.webp)
- [Brain before](before-brain.webp) · [Brain after](after-brain.webp)
- [Rain by day](after-rain-day.webp) · [Rain by night](after-rain-night.webp)
- [Leaf light close-up](after-komorebi.webp) · [Soot sprites](after-soot.webp) · [Phone](after-mobile.webp)
