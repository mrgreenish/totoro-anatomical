# Lung tissue texture

Created September 11, 2026 using the built-in `image_gen` tool, in exactly one generation request. No patient photograph or external image was used. This is an original artistic base-color texture, not anatomical evidence.

The requested size was 2048 × 2048; the tool returned **1254 × 1254**. The returned original is preserved in `pleura-source.png`. `scripts/build-lung-textures.mjs` converts it to a quality-94 WebP at its native resolution; it does not enlarge or repaint it. The runtime uses a mirrored horizontal repeat to avoid an open seam. Independent deterministic normal/roughness textures supply fine relief. The texture includes some inherent septal shading and should not be described as measured, calibrated or fully unlit scan data.

Exact prompt:

> Use case: scientific-educational
> Asset type: Original photorealistic lung pleural tissue base-color texture for an educational 3D lung.
> Primary request: 2048x2048 square tileable unlit diffuse/albedo texture covering an approximately 15cm patch of healthy inflated human lung pleura. Dense subtle irregular polygonal pulmonary lobules, fine dark mauve septal network, delicate subpleural branching red microvessels, warm muted dusty rose, peach, grey-mauve tissue variation and ultra-fine spongy grain beneath a moist translucent visceral pleura. Flat orthographic top-down texture entirely edge-to-edge. Natural biological tissue detail at many scales with low contrast and photorealism.
> Constraints: Seamlessly tileable. No anatomical silhouette, no lung object, no lighting or specular highlights, no shadows, no wrinkles/fissures larger than fine septa, no border, labels, blood pools, gore, disease, black carbon deposits, no repeating obvious pattern. Generate exactly one original image.
