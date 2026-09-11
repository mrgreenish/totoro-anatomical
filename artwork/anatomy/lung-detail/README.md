# Isolated lung study

Four organs now share the detailed study chooser. The lung study has three modes:

- **Whole lungs:** five separately modeled lobes, oblique/horizontal fissures, a left cardiac notch, C-shaped tracheal cartilage, attached main bronchi and an animated diaphragm. Generated pleural albedo combines with deterministic micro-normal/roughness maps and a restrained tissue-scattering shader.
- **Follow the air:** an explicitly illustrative transparent envelope exposes branching bronchi/bronchioles. Cyan particles move inward during inspiration, amber particles move outward during expiration. Airflow stops at the turning points. Cartilage and tissue remain visible around the flow.
- **Air sacs:** an enlarged cut-open alveolar sac, neighbouring alveoli, epithelial nuclei, capillaries on the outer posterior membrane, instanced biconcave red blood cells, and opposing oxygen/carbon-dioxide movement. Blood changes from dark red to brighter red as it picks up oxygen. Membrane transmission uses a water-like refractive index; mobile skips the extra transmission pass.

The breathing controls provide pause/play, half/normal/faster demonstration speed, restart, a manual phase slider and labels. The diaphragm flattens and descends as lung volume increases. A shared five-second cycle keeps motion, airflow and explanatory copy synchronized. Gas exchange continues between breaths. Expansion is relative to the resting lung volume, not empty lungs. The scene's pause control and local breathing control cooperate. Reduced motion disables automatic motion while leaving manual exploration available.

On narrow screens the 3D viewport is sticky, so the model remains visible when using the controls. Four labeled organ cards replace the previous narrow three-column chooser. A persistent four-way switcher shows the selected organ, and the existing cancellation, retry, Escape/back, focus restoration and camera restoration behavior is preserved.

## Performance

The lung module and its three runtime textures load only when selected. The microscopic geometry is built only when Air sacs is selected. GPU resources and decoded image bitmaps are disposed on exit; only compressed blobs are retained for reopening. Air motion updates shader uniforms rather than vertex arrays. Blood and gas particles are instanced; topology is fixed while breathing. Hidden microscopic models do not update. Paused rendering can idle, and the controls do not rerender unchanged snapshots.

- Runtime texture payload: 1,150,098 bytes (about 1.15 MB decimal).
- Desktop surface: 54,076 triangles / 12 visible submissions.
- Desktop airway reveal: 154,316 triangles / 15 visible submissions.
- Desktop air sacs: 60,564 triangles / 9 visible submissions before physical transmission's extra renderer passes.
- Smaller screens use fewer branches, surface subdivisions, cells and decoded texture pixels.

`verification.json` records the actual model/lifecycle tests and clearly distinguishes CPU timings from GPU performance. `browser-verification.json` records observed browser checks and frame samples. Browser frame samples describe this host and viewport, not a physical phone or a cross-device guarantee.

## Reproduction

`node scripts/build-lung-textures.mjs` reproduces normal/roughness maps and converts the preserved generated albedo to WebP. See `texture-provenance.md` for the exact prompt and native resolution. `node scripts/verify-lung-view.mjs` covers breathing math, visible geometry, resource budgets, lazy loading, switching, pause, retry, cancellation, reduced motion and cleanup. The existing brain/heart/eye integration suites also pass.

## Scientific basis and limits

Breathing and gas-exchange explanations follow [NHLBI's respiratory-system overview](https://www.nhlbi.nih.gov/health/lungs/respiratory-system), [breathing and gas exchange](https://www.nhlbi.nih.gov/health/lungs/breathing-benefits), and [the role of the diaphragm](https://www.nhlbi.nih.gov/health/lungs/body-controls-breathing). Lobar structure follows [NCBI's lung anatomy reference](https://www.ncbi.nlm.nih.gov/books/NBK470197/).

This is a human-inspired educational model inside a fictional-character exhibit. It is not a measured specimen or a clinical simulator. There is no patient imagery. Tissue colors/textures are artistic. Whole-lung branching is truncated; gas particles, blood cells, membrane thickness and diffusion are enlarged/slowed; transparent tissue is an explanatory visualization. Air remains a mixture of gases; its particles are not all oxygen or all carbon dioxide. Blood is always red. The lungs have no lens: the pre-existing eye's corneal/lenticular refraction is preserved and regression-tested.
