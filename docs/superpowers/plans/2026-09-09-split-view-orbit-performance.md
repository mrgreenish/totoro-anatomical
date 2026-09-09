# Split-view Orbit Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the current light-space shadow map while the camera orbits in split view so interaction renders less work without a visible quality reduction.

**Architecture:** Put the freeze/settle/refresh lifecycle in a small state controller that can be tested without a browser or WebGL context. `totoro-scene.ts` will connect that controller to OrbitControls start/end events and update it once per render after `controls.update()` reports whether damping still changed the camera.

**Tech Stack:** TypeScript 5.9, Three.js 0.180, OrbitControls, Node assertion-based verification scripts, vinext.

## Global Constraints

- Preserve the full section-cap pipeline, materials, lighting, and device pixel ratio.
- Cache shadows only in split mode while the brain detail view is closed.
- Restore normal shadow updates after controls settle, when leaving split mode, and during disposal.
- Do not modify the existing uncommitted brain-view work.
- Do not commit or push changes.

---

## File Structure

- Create `lib/split-shadow-cache.ts`: a DOM- and Three.js-independent shadow update state controller.
- Create `scripts/verify-split-shadow-cache.mjs`: lifecycle regression checks for the controller.
- Modify `lib/totoro-scene.ts`: connect the controller to OrbitControls and the render loop.

### Task 1: Shadow update state controller

**Files:**
- Create: `scripts/verify-split-shadow-cache.mjs`
- Create: `lib/split-shadow-cache.ts`

**Interfaces:**
- Consumes: an object with mutable `autoUpdate: boolean` and `needsUpdate: boolean` properties.
- Produces: `createSplitShadowCache(shadowMap)` with `begin(splitActive)`, `end()`, `update(splitActive, controlsChanged)`, `dispose()`, and a read-only `frozen` property.

- [ ] **Step 1: Write the failing lifecycle verification**

Create `scripts/verify-split-shadow-cache.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('lib/split-shadow-cache.ts', 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { createSplitShadowCache } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
);

const shadowMap = { autoUpdate: true, needsUpdate: false };
const cache = createSplitShadowCache(shadowMap);

cache.begin(true);
assert.equal(cache.frozen, true);
assert.equal(shadowMap.autoUpdate, false);
assert.equal(shadowMap.needsUpdate, false);

cache.end();
cache.update(true, true);
assert.equal(cache.frozen, true, 'damping keeps the cached map');

cache.update(true, false);
assert.equal(cache.frozen, false);
assert.equal(shadowMap.autoUpdate, true);
assert.equal(shadowMap.needsUpdate, true, 'settling forces one fresh shadow map');

shadowMap.needsUpdate = false;
cache.begin(false);
assert.equal(cache.frozen, false, 'other modes never freeze shadows');

cache.begin(true);
cache.update(false, true);
assert.equal(cache.frozen, false, 'leaving split restores shadows immediately');
assert.equal(shadowMap.needsUpdate, true);

shadowMap.needsUpdate = false;
cache.begin(true);
cache.dispose();
assert.equal(cache.frozen, false);
assert.equal(shadowMap.autoUpdate, true);
assert.equal(shadowMap.needsUpdate, true, 'dispose restores renderer defaults');

console.log(JSON.stringify({
  passed: true,
  verified: ['freeze', 'damping', 'settled refresh', 'mode exit', 'dispose'],
}, null, 2));
```

- [ ] **Step 2: Run the verification to confirm it fails**

Run:

```bash
node scripts/verify-split-shadow-cache.mjs
```

Expected: failure with `ENOENT` for `lib/split-shadow-cache.ts`.

- [ ] **Step 3: Implement the minimal controller**

Create `lib/split-shadow-cache.ts`:

```ts
type ShadowMapState = {
  autoUpdate: boolean;
  needsUpdate: boolean;
};

export type SplitShadowCache = {
  readonly frozen: boolean;
  begin(splitActive: boolean): void;
  end(): void;
  update(splitActive: boolean, controlsChanged: boolean): void;
  dispose(): void;
};

export function createSplitShadowCache(shadowMap: ShadowMapState): SplitShadowCache {
  let interacting = false;
  let frozen = false;

  const restore = () => {
    if (!frozen) return;
    shadowMap.autoUpdate = true;
    shadowMap.needsUpdate = true;
    frozen = false;
  };

  return {
    get frozen() {
      return frozen;
    },
    begin(splitActive) {
      interacting = splitActive;
      if (!splitActive) {
        restore();
        return;
      }
      if (!frozen) {
        shadowMap.autoUpdate = false;
        frozen = true;
      }
    },
    end() {
      interacting = false;
    },
    update(splitActive, controlsChanged) {
      if (!splitActive || (frozen && !interacting && !controlsChanged)) restore();
    },
    dispose() {
      interacting = false;
      restore();
    },
  };
}
```

- [ ] **Step 4: Run the focused verification**

Run:

```bash
node scripts/verify-split-shadow-cache.mjs
```

Expected: exit code 0 and JSON with `"passed": true`.

- [ ] **Step 5: Check the new files**

Run:

```bash
pnpm exec oxlint lib/split-shadow-cache.ts scripts/verify-split-shadow-cache.mjs
```

Expected: exit code 0 with no diagnostics.

### Task 2: OrbitControls and renderer integration

**Files:**
- Modify: `lib/totoro-scene.ts:1-8`
- Modify: `lib/totoro-scene.ts:155-253`
- Modify: `lib/totoro-scene.ts:254-259`
- Modify: `lib/totoro-scene.ts:274-289`
- Test: `scripts/verify-split-shadow-cache.mjs`

**Interfaces:**
- Consumes: `createSplitShadowCache(renderer.shadowMap)` from Task 1 and `anatomy.state`.
- Produces: cached shadow rendering from OrbitControls start until post-release damping settles.

- [ ] **Step 1: Import and create the controller**

Add the import:

```ts
import { createSplitShadowCache } from './split-shadow-cache';
```

After enabling the renderer shadow map, create the controller:

```ts
renderer.shadowMap.enabled = true;
const splitShadowCache = createSplitShadowCache(renderer.shadowMap);
```

- [ ] **Step 2: Update the cache lifecycle before each render**

After `anatomy?.update(dt, animated)` and before `renderer.render(...)`, add:

```ts
const splitShadowsEligible = anatomy?.state.mode === 'split'
  && anatomy.state.brainView.status !== 'open';
splitShadowCache.update(splitShadowsEligible, changed);
```

This position lets a settled frame restore `autoUpdate`, set `needsUpdate`, and render the refreshed shadow map immediately.

- [ ] **Step 3: Connect OrbitControls start and end**

Replace the existing handlers with:

```ts
const onStart = () => {
  interactionUntil = Infinity;
  resetting = false;
  anatomy?.stopCameraMotion();
  splitShadowCache.begin(
    anatomy?.state.mode === 'split' && anatomy.state.brainView.status !== 'open',
  );
  wake();
};
const onEnd = () => {
  interactionUntil = performance.now() + 1800;
  splitShadowCache.end();
  wake();
};
```

- [ ] **Step 4: Restore shadow behavior during disposal**

In `controller.dispose()`, call the controller before disposing the renderer:

```ts
splitShadowCache.dispose();
renderer.dispose();
```

- [ ] **Step 5: Run focused and existing runtime checks**

Run:

```bash
node scripts/verify-split-shadow-cache.mjs
node scripts/verify-anatomy-runtime.mjs
node scripts/verify-brain-view.mjs
```

Expected: all commands exit 0 and each report contains `"passed": true`.

- [ ] **Step 6: Run static and production checks**

Run:

```bash
pnpm lint
pnpm build
git diff --check
```

Expected: all commands exit 0. Existing unrelated warnings, if any, must be reported rather than hidden.

### Task 3: Browser performance regression

**Files:**
- Verify only: `lib/totoro-scene.ts`
- Preserve: current uncommitted files shown by `git status --short`

**Interfaces:**
- Consumes: the integrated split shadow cache from Task 2.
- Produces: measured before/after evidence for the midpoint, all-systems split-view orbit.

- [ ] **Step 1: Reproduce the baseline scenario**

In a clean local browser session:

1. Open `http://localhost:3000/`.
2. Wait for the sculpture controls to enable.
3. Enter Split mode.
4. Keep every system visible.
5. Select the side-to-side axis at 50%.
6. Orbit from a point away from the cutting-plane handle.

Expected pre-change reference: 19–21 ms per frame, 703 draw calls, 1,315,765 triangles, and 121 ms interaction latency with 112 ms presentation delay.

- [ ] **Step 2: Record the orbit while shadows are cached**

Capture a browser performance trace during the drag and inspect `canvas.dataset.renderStats`.

Expected:

- Input processing remains near 1 ms.
- Presentation delay is lower than the 112 ms baseline.
- During interaction, draw calls and triangles are lower because the anatomy shadow pass is reused.
- No section surfaces, lighting, or shadow appearance visibly pop during camera movement.

- [ ] **Step 3: Verify the settled refresh**

Stop moving the camera and wait for OrbitControls damping to finish.

Expected:

- A fresh shadow render occurs after settling.
- The idle split view returns to its normal full-quality rendering.
- Changing to Exterior or opening brain detail does not leave `shadowMap.autoUpdate` disabled.

- [ ] **Step 4: Review only intended changes**

Run:

```bash
git status --short
git diff -- lib/totoro-scene.ts lib/split-shadow-cache.ts scripts/verify-split-shadow-cache.mjs
```

Expected: only the planned implementation appears in this focused diff. Do not stage, commit, or push.
