# Totoro: Blender refinement plan

Prepared and implemented 7 September 2026. The findings below describe the baseline; the implementation record describes the delivered refinement.

## Implementation record

The editable source, optimized browser model, matching poster and local gallery have been updated. Blender MCP ran the authoring, inspection and verification in a separate process, preserving the unrelated modified scene in the user's live Blender window.

- Face and transitions: inset eyes with closing eyelids, fuller cheek support, softer charcoal nose, embedded shoulders/tail base, slightly asymmetric ears, and a thinner curled leaf with crown clearance.
- Coat: shorter coherent strands, improved arm/tail coverage, flatter surface-following chevrons, feathered belly colour boundary and softer microdetail. Regional groom parameters remain reproducible in the generator. Main surfaces now have UVs; the final browser coat retains procedural microdetail instead of adding baked maps or a simulated hair groom.
- Motion: seven bones with blended skin weights provide breathing and shoulder/ear/tail deformation. Eyelid shape keys cover full-volume eyes. Fur and claws follow their surfaces; paws stay planted.
- Cleanup and cost: closed body/ear openings, shared fiber materials and consolidated static details. The final model has 324,967 triangles, 57 mesh draws and a 4,844,876-byte compressed transfer, down from 460,408 / 71 / 6,608,872.
- Validation: native and exported attachment checks pass, both eyelids occlude their pupils when closed, all teeth and seven markings remain visible, and glTF validation reports zero errors/warnings. Fixed four-angle renders retain 99.06% opaque silhouette overlap. Browser interaction and narrow-screen checks, motion consistency, TypeScript, changed-file lint and the production build pass.

Comparisons and backups are retained locally under `outputs/blender-refinement/`. The editable source is `artwork/totoro.blend`; verification reports are alongside it. The requested implementation is saved locally; publishing the existing hosted site was not requested.

## Recommendation

Refine the face, coat and transitions between body parts before adding animation complexity. The largest visual gain should come from making the character feel like one soft creature, with integrated features and a coherent coat. Preserve the broad ten-tooth grin, seven belly markings, leaf, overall proportions and existing interactive gallery.

Blender MCP is working. Both the live scene query and background inspection of `artwork/totoro.blend` succeeded. The live window contains a different, modified startup scene, so the Totoro review used the saved project in a separate background process. Fresh profile and rear renders were made without saving changes to the source file.

The new advantage is direct access to scene state, object inspection and an interactive edit–view–compare loop. Earlier work already used Blender scripts and offline renders, so these modelling operations were not fundamentally impossible before MCP became available.

## Findings

Visual observations are based on the existing portrait render, fresh profile and rear renders, and the local reference stills `totoro032.jpg` and `totoro036.jpg`. Interpretations of softness and likeness are artistic judgments, not numerical defects.

| Finding | Evidence and implication |
| --- | --- |
| Facial features still read as separate pieces | The profile exposes the eye rim; the portrait shows tubular upper lids and a strongly glossy nose. Integrating these features should improve likeness at close range. |
| Coat consistency needs work | The body has a dense, strongly directional texture, while arms and tail appear smoother. The belly boundary and raised chevrons emphasize separate layers. |
| Limb transitions are abrupt | Shoulder and tail attachments remain visually distinct from the torso. Their local contours and fur can blend more naturally while retaining separate animation controls. |
| Fur dominates geometry cost | The existing decoded export report records 460,408 triangles, of which 363,864—79%—are fibers, with 71 mesh draws and a 6.61 MB compressed model. These are the current report's measurements, not a new device benchmark. |
| Deformation is limited | MCP inspection found no armature, shape keys or vertex groups. Runtime code produces blinking by scaling the eyes and pupils, and breathing by scaling the moving character group. |
| Authoring cleanup would help | Body, belly, ears, arms and feet lack UV maps. Body and ears have open boundary loops and no remaining modifiers. Some openings are intentional or concealed; this does not establish a visible rendering fault. |

## Ordered work

### 1. Establish a repeatable comparison

- Create a versioned working copy and capture front, three-quarter, profile and rear views under fixed lighting, plus close-ups of the face, shoulder and belly edge.
- Use the existing reference stills to record eye spacing, nose width, grin curvature and cheek profile. Allow for the different poses and the translation from drawings into a standing sculpture.
- Establish a browser baseline for appearance, frame time and total asset transfer at desktop and narrow-screen sizes. Screen-size checks alone will not be described as mobile-device benchmarks.
- Make changes reproducible through the build source or a saved refinement step. Ensure the existing generator cannot silently erase authored refinements.

### 2. Integrate the face and body forms — highest visual priority

- Shape shallow eye sockets and fleshier eyelid contours, reducing the visible rim around the eyeballs.
- Refine the cheek shelf, muzzle and smile corners together so the grin wraps naturally in profile. Preserve ten broad, individually curved teeth; tune their alignment and spacing rather than replacing the smile.
- Give the nose a softer material response and review its contour against the references.
- Blend shoulder roots and the tail base through local mesh shaping and overlapping fur. Add restrained asymmetry to ear bends and relaxed arm placement.
- Thin and curl the leaf edge, taper its veins, and improve its contact with the crown.

Review gate: the features feel embedded from front and side views, the grin remains immediately recognizable, and attachment seams remain closed throughout the existing motion range.

### 3. Rework the coat and belly markings — highest material priority

- Author regional grooming: short fur around eyes and mouth, soft belly fur, slightly longer cheek/shoulder tufts, and consistent flow across arms and tail.
- Reduce the raised appearance of the chevrons and soften the cream-to-grey boundary. Express the markings primarily through fur colour, with only enough geometry to support the silhouette.
- Prototype one shoulder-and-body patch first, comparing the present fibers with a groomed version that combines fewer visible strands with baked surface detail.
- Add UVs where baked normal, colour and roughness detail is useful. Keep these channels distinct and compare them under both daylight and moonlight.
- Keep an editable groom in the Blender source; build and verify a separate mesh/texture representation for the browser. Choose the final method from appearance and performance results.

Review gate: the coat looks coherent across adjacent parts, stays soft at gallery distance, and avoids visible shimmer, clipping or distracting triangular strands while orbiting.

### 4. Add natural deformation — after the surface treatment is stable

- Prototype eyelid shape keys on one eye, then implement both eyes. Eyelids should close over eyeballs that retain their volume.
- Add a small rig for subtle torso breathing, shoulder movement, ear bends and tail settling. Keep the paws planted and retain the existing responsive spring motion as the control input where appropriate.
- Make the fur, belly markings and facial attachments follow the same deformations as their underlying surfaces. Review the exported result, not just the Blender animation.
- Verify one eye and one moving shoulder through the current compression and loading pipeline before expanding the setup. Blender's glTF exporter supports shape-key and skeletal animation, but this project's optimizations and material replacement still need an end-to-end check. [Blender 5.1 glTF documentation](https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html)

Review gate: eyelids close cleanly, fur stays attached, feet remain planted, and pause, reset and reduced-motion behaviour remain intact.

### 5. Clean up, optimize and validate

- Repair unintended openings at body poles and ear tips where needed. Preserve deliberate open fur ribbons and surface patches.
- Retain editable modifiers where useful; simplify hidden geometry and consolidate equivalent materials and static details without losing animation controls.
- Investigate a 25–40% reduction from the current triangle count as a prototype target, not a guaranteed result. Measure texture transfer, draw calls and deformation cost alongside triangle count.
- Regenerate the browser model and poster, then run the existing model, glTF and motion checks with updates for the new rig and eyelids.
- Compare all four angles and close-ups in Blender and the actual gallery; check orbiting, zoom, both lighting modes, animation, pause/reset, loading and narrow-screen framing.

Completion gate: demonstrated visual improvement in matched views, no attachment or interaction regressions, and measured browser cost that justifies the final asset choices. Deliver the editable Blender source, reproducible refinement/export steps, optimized model, matching poster and comparison renders.

## Scope and order

Recommended first delivery: face and attachment refinement plus the coat prototype. It gives a concrete visual comparison before committing to the larger grooming and deformation work. Rigging follows once the mesh and coat approach are settled. The exact hidden anatomy and resting pose remain artistic interpretations of the existing references.
