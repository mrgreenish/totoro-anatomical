# Totoro — Quiet Forest

An interactive Totoro sculpture created in Blender 5.1, exported to glTF, and rendered with Three.js in a responsive gallery.

## Artwork

- `artwork/totoro.blend`: editable model, materials, studio lighting, and camera.
- `artwork/totoro-render.png`: transparent Cycles render.
- `artwork/totoro-raw.glb`: uncompressed export.
- `public/models/totoro.glb`: Meshopt-compressed browser model (4,844,876 bytes).
- `scripts/build_totoro.py`: deterministic procedural Blender source.
- `scripts/totoro_rig.py`: seven-bone deformation rig, UVs and shared skin weights.
- `scripts/optimize-model.mjs`: export optimization and glTF validation.
- `scripts/verify-model.mjs`: compressed-model decoding, visible teeth/markings, eyelids, skinning, attachment and camera checks.
- `scripts/verify_totoro_blender.py`: closed body surfaces and fur attachment in rest and deformed poses.
- `scripts/render_totoro_views.py`: repeatable front, three-quarter, profile and rear renders.

The sculpt has a wide crescent grin with ten individually curved enamel crowns, a broad nose, smaller inset eyes, lofted cheeks and torso, shaped forearms, five attached claws per hand, lofted paws with flat soles and three short embedded claws, a dense groomed coat and a leaf draped over the crown. Face and profile proportions were studied against [Studio Ghibli's official Totoro stills](https://www.ghibli.jp/works/totoro/), particularly frames 030, 032, 034 and 036. The result is a stylized 3D adaptation; the neutral stance and concealed anatomy are inferred.

## Interaction

Drag to orbit, scroll or pinch to zoom. With the canvas focused, arrow keys rotate, plus/minus zoom, and Home resets the camera. The toolbar controls auto-rotation, character motion, resetting, and fullscreen. Daylight switches to moonlight. The character breathes and blinks. Orbit release glides, and angular velocity drives damped springs in the torso, ears, leaf and arms. Paws, toe claws and paw fur remain planted while the torso settles. Pause clears secondary momentum; reduced-motion preferences disable it initially.

## Rendering

324,967 model triangles and 57 mesh draws: 29.4% fewer triangles and a 26.7% smaller download than the previous coat. Meshopt compression cuts the 25.6 MB export to 4.84 MB. There are no external texture/HDR requests. A WebP render appears while the GPU programs compile. Shorter bent strands, shared fiber materials, surface-aligned normals and regional vertex colors create a coherent coat across the body, arms and tail. The belly boundary feathers into grey, and the seven chevrons follow the belly surface. The thinner curled leaf clears the crown. Physical sheen, AgX tone mapping, studio reflections and contact shadows finish the real-time render. Versioned model and poster requests refresh the cached sculpture together.

Both eyelids have a Blink shape key that closes over unchanged eyeballs. Seven bones deform breathing, shoulders, ears and tail; their fur, claws and belly markings share the corresponding skin weights. The head keeps its proportions, and the paws remain planted. Body poles and ear openings are closed. Regional strand parameters, shape keys, UVs and armature modifiers remain editable in the native source. The chosen coat uses fewer mesh strands plus subtle runtime microdetail; baked texture maps and simulated hair were not added.

Animation stays outside React state. Orbit damping and character animation use delta time. Pixel ratio is capped at 1.8 and decreases after sustained slow frames. Rendering stops in hidden tabs, and stops after settling when motion is paused. GPU resources and listeners are released on unmount. Reduced-motion preferences disable initial idle animation.

## Development

```sh
npm install
npm run dev
npm run build
```

Run `node scripts/verify-motion.mjs` to verify release momentum, spring follow-through, 30/60/120 Hz consistency, rapid reversals and pause/reset behavior.

Recreate the model with `blender -b --python scripts/build_totoro.py`, then run `node scripts/optimize-model.mjs` and `node scripts/verify-model.mjs`. Convert `artwork/totoro-render.png` to `public/totoro-poster.webp` after changing the model. Render review angles with `blender -b artwork/totoro.blend --python scripts/render_totoro_views.py`. Optional `TOTORO_SAMPLES`, `TOTORO_RESOLUTION` and `TOTORO_SKIP_RENDER=1` environment variables control offline review speed.

## Verification

The compressed file is decoded with the gallery's Three.js loader and Meshopt decoder. Verification checks all named animation parts, finite vertices, transfer/triangle budgets, expected bounds, front-ray visibility of ten teeth and seven markings, normalized skin weights, actual deformed vertices, eyelid closure and initial desktop/mobile camera framing. Results are in `artwork/model-verification.json`. Native Blender checks find no boundary edges on the body or appendages and verify sampled fur roots stay within 0.0034 model units of their surfaces in rest and exaggerated motion poses. The glTF validator reports zero errors and warnings; its unsupported Meshopt extension is checked with the actual Three.js decoder.

Front, three-quarter, profile and rear Cycles renders were reviewed. The opaque silhouette retains 99.06% overlap with the previous sculpt. Browser QA covered dragging, keyboard orbit/zoom, both lighting modes, auto-rotation, pause/reset, fullscreen and a 390 × 844 viewport without horizontal overflow. A stable desktop observation at DPR 1 measured 10 ms median / 11 ms p95 frame intervals; this is not a hardware-wide performance benchmark. Numerical motion checks pass at 30/60/120 Hz with maximum angular difference below 0.005 radians. TypeScript, lint on changed application/verification files and the production build pass. See `artwork/browser-verification.json` and `artwork/blender-improvement-plan.md` for scope and implementation notes.

Fan-made tribute to the character from *My Neighbor Totoro*. Not affiliated with Studio Ghibli.

## Detailed brain study

Zoom toward the exposed brain, or select “Brain · cerebral hemispheres” in the anatomy inspector. A subtle “Open brain view” button appears once the brain fills 30% of the canvas's shorter dimension. It remains available down to 22% to avoid flicker; hidden, occluded, and completely clipped brains do not offer entry. Clicking opens an isolated brain with free orbit. Back or Escape restores the previous camera, cut, filters, separation, and selection. Pause freezes neural and vascular motion; reduced motion disables automatic motion.

The independent close-up contains 299,276 geometry triangles, surface-conforming vascular branches, and 24 neural paths. Geometry and textures load when the study is opened, stay cached as compressed blobs for reopening, and leave the GPU when returning to anatomy so split view stays responsive. Color and normal maps use 4096 pixels on desktop and 2048 on mobile or hardware limited to smaller textures. Supporting surface and membrane maps use 2048 pixels. The color map combines a new ImageGen tissue source with continuous object-space projection. Normal, height, roughness, curvature-derived ambient occlusion, wetness, and thickness maps are analytically baked at the same UV coordinates used by the cortex generator. The source height bake is 16-bit; browser PNG decoding uses the explicitly exported 8-bit runtime copy. Light scattering and subsurface impulses are artistic real-time approximations.

Rebuild with `blender -b --python scripts/build-brain-detail.py`, then `node scripts/optimize-brain-detail.mjs`. Editable source, full-resolution bakes, provenance, and four offline review renders are in `artwork/anatomy/brain-detail/`. Deployment assets are in `public/models/brain-detail/`. The optimizer must preserve unused vertex attributes because texture bindings are added at runtime rather than embedded in the GLB.

Run `node scripts/verify-brain-view.mjs` for proximity, occlusion, clipping, loading, restoration, texture bindings, UV retention, animation and cleanup checks. This complements the existing anatomy and brain material checks. Browser verification covered entry, detailed rendering, keyboard orbit/zoom, pause/play, Escape, cached reopening, and a 390 × 844 viewport without shader errors. Offline renders are separate from browser rendering and do not imply identical lighting.

## Anatomy explorer

Exterior remains the initial view. Split uses one model-space cutting plane, with three directions, reversal, an on-model drag handle and a keyboard slider. Stencil passes create tissue-colored section surfaces from closed volumes, including inward cavity walls. Only visible volumes intersecting the plane participate. Exploded interpolates captured original transforms toward authored diagram offsets; bones stay central, skin and muscles move aside, organs fan forward, and the vascular and nervous trees move into layers. Click a part or choose its name to focus it. The seven system filters persist across anatomy modes. Character deformation pauses while anatomy is active, preserving the previous motion preference. Reset clears the anatomy controls and returns to Exterior.

The additional anatomy contains 264 identifiable parts and 484,316 triangles. The optimized asset is about 11.08 MB. This is an imagined, human-inspired anatomical model fitted to Totoro, with major visible structures, simplified branching networks and attachment regions. It is not a medical reference. Microscopic structures, reproductive anatomy and a complete lymphatic network are outside its scope.

The editable source is `artwork/anatomy/totoro-anatomy.blend`; the previous exterior file remains separate. Geometry and original transforms are stored alongside `partId`, label, system membership, assembly group, cavity flags and explosion offsets. Blender uses Z up / front −Y; metadata offsets and the browser use glTF Y up / front +Z. The manifest, exported validation reports, texture maps and review renders are under `artwork/anatomy/`.

### Rebuild through Blender MCP

Install the [Blender MCP add-on and server](https://github.com/ahujasid/blender-mcp), then open a dedicated Blender GUI instance with `blender artwork/totoro.blend --python scripts/blender_mcp_host.py`. Its add-on listens locally on port 9877. `scripts/blender_mcp_client.py` launches the official MCP server with `uvx`, initializes a genuine MCP session, and calls the add-on's `execute_blender_code` tool. It does not modify the original exterior file. Keep Blender's GUI event loop running; the add-on cannot execute modeling in Blender background mode.

```sh
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py --info
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/build_anatomy.py skeleton
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/build_anatomy.py organs
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/build_anatomy.py muscles
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/build_anatomy.py networks
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/build_anatomy.py details
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/bake_anatomy.py
uv run --with 'mcp>=1.9,<2' scripts/blender_mcp_client.py scripts/finalize_anatomy.py
node scripts/optimize-anatomy.mjs
node scripts/verify-anatomy-asset.mjs
node scripts/verify-anatomy-runtime.mjs
```

`BLENDER_MCP_SOURCE` can point to a checkout of the integration. Each geometry stage is reproducible; the skeleton stage starts a fresh anatomy collection. The final pass fits superficial parts to the source envelope, preserves the tissue topology, triangulates only for export, and restores editable geometry afterward. Albedo textures were generated with Image Gen. Normal and roughness maps were independently baked in Blender; the web export keeps these channels lossless and optimizes the albedo maps to WebP. The optimization scripts use the installed `sharp` encoder.

Anatomical cavity placement follows [OpenStax Anatomy and Physiology 2e, anatomical terminology](https://openstax.org/books/anatomy-and-physiology-2e/pages/1-6-anatomical-terminology). Runtime section passes follow the [Three.js clipping stencil example](https://threejs.org/examples/webgl_clipping_stencil.html). Blender Boolean review sections and browser stencil sections use different algorithms; the browser is the final reference for interactive cuts.

### Organ realism refinement

The organs now use nine separate tissue atlases, with albedo at 1024 pixels and normal/roughness channels at 512 pixels. These maps are baked in Blender from continuous model-space tissue shaders onto the actual geometry. Fine surface mottling, restrained capillary variation, and local cavity shading remain continuous across UV seams. Physical dielectric coats and distinct roughness values separate the liver, kidneys, myocardium, lungs, digestive walls, glands, and cortex. The runtime uses neutral studio illumination and organ contact shadows; section surfaces retain the appropriate tissue color even when a texture uses a white base-color multiplier.

The heart has surface-projected coronary branches, auricles and hollow great-vessel roots. The liver has asymmetric lobes and a recessed fissure. The cortex has rounded sulci, and the small bowel and haustrated colon have smoother cross-sections with preserved lumen walls. Part IDs, filtering, selection, explosion offsets, and existing cavity structure remain available.

Run the refinement on the existing Blender source, then optimize and validate:

```sh
blender -b artwork/anatomy/totoro-anatomy.blend --python scripts/refine_anatomy.py
node scripts/optimize-anatomy.mjs
node scripts/verify-anatomy-asset.mjs
node scripts/verify-anatomy-runtime.mjs
blender -b artwork/anatomy/totoro-anatomy.blend --python scripts/render_organ_studies.py
```

`bake_organ_tissues.py` can rebake the organ atlases independently. The four `*-realistic.png` studies under `artwork/anatomy/reviews/` show the assembly, heart, brain, and abdomen with 48-sample denoised Cycles rendering. These are offline render checks; they do not establish browser frame rates or pixel-identical GPU shading. The asset checks verify closed finite volumes, all 264 stable IDs, independent tissue textures, normal tangents, physical coats, and the existing 12 MB / 500,000 triangle limits. Runtime integration checks exercise filtering, clipping controls, explosion/reassembly, selection, reset and resource cleanup.
