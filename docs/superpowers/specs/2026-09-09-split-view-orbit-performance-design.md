# Split-view orbit performance

## Goal

Make orbiting in split view smoother without a visible quality reduction and without changing the section-cap rendering algorithm.

## Evidence

At the midpoint side-to-side cut with every anatomy system visible:

- Exterior: 10–11 ms per frame, 62 draw calls, 327,211 triangles.
- Split: 19–21 ms per frame, 703 draw calls, 1,315,765 triangles.
- A real orbit trace measured 121 ms interaction latency: 8 ms input delay, 1 ms event processing, and 112 ms presentation delay.
- CPU profiling attributed about 28% of Three.js render-submission time to shadow rendering.

The bottleneck is therefore render presentation, not OrbitControls input handling or brain-visibility raycasts.

## Design

Reuse the most recent shadow map while a split-view camera interaction is active and while OrbitControls damping is settling.

1. On OrbitControls `start`, freeze shadow-map updates when split mode is active.
2. Continue rendering the scene against the cached shadow map during the interaction.
3. On OrbitControls `end`, keep updates frozen while damping still changes the camera.
4. On the first frame where the interaction has ended and controls no longer change, restore automatic shadow updates and force one shadow refresh.
5. Restore normal shadow behavior immediately if the view leaves split mode or the scene is disposed.

Camera movement does not change a light-space shadow map. The only temporarily stale contribution can be the subtle animated heartbeat shadow; the forced settled-frame refresh returns it to the current pose.

## Scope

The change belongs in `lib/totoro-scene.ts`, where OrbitControls, the animation loop, and the renderer shadow map are already coordinated.

This iteration does not lower device pixel ratio, hide section caps, change materials, batch geometry, or modify existing uncommitted brain-view work.

## Verification

- Add a focused regression check for freeze, damping, refresh, mode-exit, and disposal behavior.
- Run lint, build, and the existing anatomy runtime and brain-view verification scripts.
- Repeat the same real-browser midpoint/all-systems orbit trace.
- Compare frame time, presentation delay, draw calls, and triangles against the recorded baseline.

Success means the interaction removes the shadow pass during orbit, improves frame/presentation timing, restores normal shadows after settling, and leaves the rendered split view visually unchanged.
