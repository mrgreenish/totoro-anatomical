# Eye study texture provenance

The iris albedo was generated once with the built-in Image Generation tool on 2026-09-09. It is original synthesized tissue, not a photograph of a person or a clinical scan. The inspected output was 1254 × 1254 pixels and was encoded, without upscaling, as `public/models/eye-detail/iris-color.webp` (WebP quality 94). The annulus samples from normalized radius .123 to .46 around (.499, .497). Pupil dilation moves the inner mesh edge and stretches the attached fibers; it does not scale a flat photograph of an entire eyeball.

The scleral albedo, scleral normal map, and retinal albedo are original deterministic maps authored by `scripts/build-eye-textures.mjs`. Branching episcleral vessels, diffuse collagen variation and fine normal relief are generated separately. Major retinal vessels are geometry. All four runtime texture maps together are approximately 466 KB. The eye geometry and materials are authored in `lib/eye-detail.ts` and `lib/eye-materials.ts`.

## Final generation prompt

Use case: photorealistic-natural

Asset type: original human iris diffuse/albedo texture for a real-time anatomical eye model, square 2048 x 2048 pixels if possible.

Primary request: A single perfectly centered, frontal orthographic circular human hazel/olive iris, isolated on an almost black background. The entire circular iris is visible and unoccluded. Outer iris radius is approximately 46% of image width, centered at 50% x 50%. A clean round black pupil is centered at exactly the same point, radius approximately 14% of image width.

Style/medium: Genuine extremely detailed macro-photographic human iris tissue, natural biological irregularity, realistic and physically plausible pigment. A flat texture map, no scene or object presentation.

Color palette and tissue: Dark brown outer limbal ring; rich natural golden-brown peripupillary collarette; subtle olive green and gray in the mid-zone. Fine branching radial stromal fibers and silky filament detail, unevenly spaced irregular crypts, small realistic brown pigment freckles, delicate concentric contraction furrows. Fine organic asymmetry within the overall circular shape. Muted natural color, not saturated.

Lighting: Even, flat cross-polarized diffuse illumination across the entire iris, preserving albedo and minute tissue detail. No baked directional shadows or ambient occlusion, no specular highlight or reflection.

Constraints: Exactly one iris texture. No cornea, sclera, eyelids, eyelashes, surrounding face, eyeball volume, iris oblique perspective, cutaway, diagrams, labels, typography, watermark, glossy shine, studio reflection, glow, sci-fi effects, stylized symmetry, artificial spokes, repeated geometric patterns, decorative rays, or painted appearance. Outside the limbal ring and inside the pupil are nearly black. Sharp useful texture detail across the entire iris, no shallow depth-of-field blur.

## Optical and educational scope

The model is inspired by human anatomy; it is not a clinical simulator. The corneal material uses a 1.376 effective index, while the immersed lens uses an equivalent relative index of 1.406 / 1.336. Three.js physical transmission provides screen-space scene refraction, finite optical thickness, roughness and subtle dispersion on the desktop tier. It is an approximation rather than a fully ray-traced gradient-index eye. Retinal cells and their spacing are magnified and illustrative. False colors identify cone families; actual cones are not red, green or blue. Sensitivity curves are broad schematic responses rather than measured color matching functions. Animated pathways are slowed, explanatory signals; light stops at the retina, and electrical messages follow the optic nerve.

The content was checked against the [National Eye Institute overview](https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/how-eyes-work), [NEI's guide for kids](https://www.nei.nih.gov/eye-health-information/healthy-vision/nei-for-kids/about-eye), and the [Neuroscience chapter on retinal image formation](https://www.ncbi.nlm.nih.gov/books/NBK11079/). The lens index is a schematic convention discussed in [Changes in equivalent and gradient refractive index with accommodation](https://pubmed.ncbi.nlm.nih.gov/9097329/).

Runtime validation and geometry budgets are in `verification.json`. These are Node integration checks with a mocked renderer, not browser screenshots or measured GPU frame rates.
