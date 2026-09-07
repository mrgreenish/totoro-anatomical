# Totoro — Quiet Forest

An interactive Totoro sculpture created in Blender 5.1, exported to glTF, and rendered with Three.js in a responsive gallery.

## Artwork

- `artwork/totoro.blend`: editable model, materials, studio lighting, and camera.
- `artwork/totoro-render.png`: transparent Cycles render.
- `artwork/totoro-raw.glb`: uncompressed export.
- `public/models/totoro.glb`: Meshopt-compressed browser model (1,263,984 bytes).
- `scripts/build_totoro.py`: deterministic procedural Blender source.
- `scripts/optimize-model.mjs`: export optimization and glTF validation.
- `scripts/verify-model.mjs`: compressed-model decoding, visible teeth, attachment and camera checks.
- `scripts/render_totoro_views.py`: repeatable front, three-quarter, profile and rear renders.

The sculpt has a wide crescent grin with ten individually curved enamel crowns, a broad nose, smaller inset eyes, lofted cheeks and torso, shaped forearms, five attached claws per hand, tapered toes, short fur and a leaf draped over the crown. Face and profile proportions were studied against [Studio Ghibli's official Totoro stills](https://www.ghibli.jp/works/totoro/), particularly frames 030, 032, 034 and 036. The result is a stylized 3D adaptation; the neutral stance and concealed anatomy are inferred.

## Interaction

Drag to orbit, scroll or pinch to zoom. With the canvas focused, arrow keys rotate, plus/minus zoom, and Home resets the camera. The toolbar controls auto-rotation, character motion, resetting, and fullscreen. Daylight switches to moonlight. The character breathes and blinks; its ears, leaf, and arms respond to rotation.

## Rendering

118,734 model triangles, 66 mesh draws, shared geometry/materials, no external texture/HDR requests. Meshopt compression cuts the original 3.82 MB model to 1.26 MB. A 72 KB WebP render appears while the GPU programs compile. Procedural microtexture, physical sheen, studio environment reflections, key/fill/rim lights, and contact shadows create the material finish. Versioned asset requests prevent the earlier closed-mouth sculpture from remaining in the browser cache.

Animation stays outside React state. Orbit damping and character animation use delta time. Pixel ratio is capped at 1.8 and decreases after sustained slow frames. Rendering stops in hidden tabs, and stops after settling when motion is paused. GPU resources and listeners are released on unmount. Reduced-motion preferences disable initial idle animation.

## Development

```sh
npm install
npm run dev
npm run build
```

Recreate the model with `blender -b --python scripts/build_totoro.py`, then run `node scripts/optimize-model.mjs` and `node scripts/verify-model.mjs`. Convert `artwork/totoro-render.png` to `public/totoro-poster.webp` after changing the model. Render review angles with `blender -b artwork/totoro.blend --python scripts/render_totoro_views.py`. Optional `TOTORO_SAMPLES`, `TOTORO_RESOLUTION` and `TOTORO_SKIP_RENDER=1` environment variables control offline review speed.

## Verification

The compressed file is decoded with the gallery's Three.js loader and Meshopt decoder. Verification checks all named animation parts, finite vertices, transfer/triangle budgets, expected bounds, actual front-ray visibility and curved depth of all ten teeth, claw/fur attachment transforms, and initial desktop/mobile camera framing. Results are in `artwork/model-verification.json`. The glTF validator reports zero errors and warnings; it cannot validate the Meshopt extension itself, so the Three.js decoder check verifies that path. Fixed front, three-quarter, profile and rear Cycles renders are reviewed for likeness and attachment. GPU browser interactions and frame rate have not been benchmarked across target devices.

Fan-made tribute to the character from *My Neighbor Totoro*. Not affiliated with Studio Ghibli.
