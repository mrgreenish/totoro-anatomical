# Totoro — Quiet Forest

An interactive Totoro sculpture created in Blender 5.1, exported to glTF, and rendered with Three.js in a responsive gallery.

## Artwork

- `artwork/totoro.blend`: editable model, materials, studio lighting, and camera.
- `artwork/totoro-render.png`: transparent Cycles render.
- `artwork/totoro-raw.glb`: uncompressed export.
- `public/models/totoro.glb`: Meshopt-compressed browser model (791,916 bytes).
- `scripts/build_totoro.py`: deterministic procedural Blender source.
- `scripts/optimize-model.mjs`: export optimization and glTF validation.

## Interaction

Drag to orbit, scroll or pinch to zoom. With the canvas focused, arrow keys rotate, plus/minus zoom, and Home resets the camera. The toolbar controls auto-rotation, character motion, resetting, and fullscreen. Daylight switches to moonlight. The character breathes and blinks; its ears, leaf, and arms respond to rotation.

## Rendering

73,222 model triangles, 35 mesh draws, shared geometry/materials, no external texture/HDR requests. Meshopt compression cuts the original 2.46 MB model to 792 KB. A small WebP render appears while the GPU programs compile. Procedural microtexture, physical sheen, studio environment reflections, key/fill/rim lights, and contact shadows create the material finish.

Animation stays outside React state. Orbit damping and character animation use delta time. Pixel ratio is capped at 1.8 and decreases after sustained slow frames. Rendering stops in hidden tabs, and stops after settling when motion is paused. GPU resources and listeners are released on unmount. Reduced-motion preferences disable initial idle animation.

## Development

```sh
npm install
npm run dev
npm run build
```

Recreate the model with `blender -b --python scripts/build_totoro.py`, then run `node scripts/optimize-model.mjs`. Convert `artwork/totoro-render.png` to `public/totoro-poster.webp` after changing the model.

## Verification

TypeScript compilation and the production build pass. The compressed file is decoded with Three.js and checked for all named animation parts and expected bounds. The glTF validator reports zero errors and warnings; it cannot validate the Meshopt extension itself, so the Three.js decoder check verifies that path. GPU frame rate has not been benchmarked across target devices.

Fan-made tribute to the character from *My Neighbor Totoro*. Not affiliated with Studio Ghibli.
