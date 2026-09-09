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
