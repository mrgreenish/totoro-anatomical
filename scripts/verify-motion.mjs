import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('lib/totoro-motion.ts', 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { createTotoroMotion } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function simulate(hz) {
  const motion = createTotoroMotion();
  const samples = [];
  for (let i = 0; i < hz * 5; i++) {
    // One-second drag followed by release. Sample at exact common wall times.
    motion.update(i < hz ? 1.8 : 0, i < hz ? .7 : 0, 1 / hz);
    if ((i + 1) % (hz / 10) === 0) samples.push({
      time: (i + 1) / hz, yaw: motion.yaw.position, lean: motion.lean.position,
      ears: motion.ears.position, leaf: motion.leaf.position,
    });
  }
  assert(!motion.settling, `Motion does not settle at ${hz} Hz`);
  assert(samples[10].yaw < -.05, 'The body must retain momentum after release');
  assert(samples.slice(10).some(sample => sample.yaw > .001), 'The torso has no spring follow-through');
  assert(samples.every(sample => Math.abs(sample.lean) < .055), 'Body lean is excessive');
  return samples;
}
const runs = [30, 60, 120].map(hz => ({ hz, samples: simulate(hz) }));
let maximumDifference = 0;
for (let i = 0; i < runs[0].samples.length; i++) {
  for (const key of ['yaw', 'lean', 'ears', 'leaf']) {
    const difference = Math.abs(runs[0].samples[i][key] - runs[2].samples[i][key]);
    maximumDifference = Math.max(maximumDifference, difference);
    assert(difference < .009, `${key} depends excessively on frame rate`);
  }
}
const motion = createTotoroMotion();
for (let i = 0; i < 300; i++) motion.update(i % 2 ? 1000 : -1000, 1000, 1 / 60);
assert(Math.abs(motion.yaw.position) < .23 && Math.abs(motion.lean.position) < .065, 'Rapid reversals become unstable');
motion.reset();
assert(!motion.settling && motion.yaw.position === 0, 'Pause/reset leaves momentum');
motion.update(NaN, Infinity, 0);
assert(!motion.settling, 'Invalid timestep changes rest state');

const report = { passed: true, frameRates: [30, 60, 120], maximumAngularDifference: maximumDifference,
  verified: ['release momentum', 'spring follow-through', 'rest after five seconds', 'frame rate consistency', 'bounded rapid reversals', 'pause/reset'],
  scope: 'Numerical dynamics verification. Pointer feel and GPU performance are not browser-benchmarked.', runs };
await writeFile('artwork/motion-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, runs: undefined }, null, 2));
