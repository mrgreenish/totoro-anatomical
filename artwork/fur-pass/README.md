# Fur pass: before and after

Captures come from the real gallery in headless Chromium (ANGLE SwiftShader, no GPU), 1280 × 900, DPR 1, daylight, same camera for each pair. "Before" is the previous coat (commit `135be2d`); "after" is this branch.

- Front, profile and nearest zoom: [before-front](before-front.webp) · [after-front](after-front.webp), [before-profile](before-profile.webp) · [after-profile](after-profile.webp), [before-nearest](before-nearest.webp) · [after-nearest](after-nearest.webp)

| | Before | After |
|---|---:|---:|
| Model triangles | 324,967 | 229,227 |
| Strand triangles | 224,859 | 129,119 |
| Mesh draws | 57 | 57 |
| Compressed model | 4,844,876 bytes | 3,287,412 bytes |
| Strand pixel-quads touched, 1280 × 900 | 51,160 | 79,979 |
| Strand pixel-quads touched, 2560 × 1800 | 167,073 | 219,756 |

Pixel-quads are the 2 × 2 pixel groups a GPU shades for each strand triangle, counted from the decoded model with 4× MSAA sample positions at the default camera, ignoring depth rejection. They are a fill-cost proxy computed on the CPU, not a GPU measurement.
