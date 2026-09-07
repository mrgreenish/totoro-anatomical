type Spring = { position: number; velocity: number };
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

// Exact underdamped spring integration for a constant target over each timestep.
// The exponential solution preserves the same weight at 30, 60 and 120 Hz.
function advance(spring: Spring, target: number, frequency: number, damping: number, dt: number) {
  const decay = damping * frequency;
  const oscillation = frequency * Math.sqrt(1 - damping * damping);
  const offset = spring.position - target;
  const coefficient = (spring.velocity + decay * offset) / oscillation;
  const cos = Math.cos(oscillation * dt), sin = Math.sin(oscillation * dt);
  const envelope = Math.exp(-decay * dt);
  spring.position = target + envelope * (offset * cos + coefficient * sin);
  spring.velocity = envelope * (spring.velocity * cos - (decay * coefficient + oscillation * offset) * sin);
}

export function createTotoroMotion() {
  const yaw: Spring = { position: 0, velocity: 0 };
  const lean: Spring = { position: 0, velocity: 0 };
  const pitch: Spring = { position: 0, velocity: 0 };
  const ears: Spring = { position: 0, velocity: 0 };
  const leaf: Spring = { position: 0, velocity: 0 };
  const arms: Spring = { position: 0, velocity: 0 };
  const springs = [yaw, lean, pitch, ears, leaf, arms];
  return {
    yaw, lean, pitch, ears, leaf, arms,
    reset() { for (const spring of springs) { spring.position = 0; spring.velocity = 0; } },
    update(azimuthVelocity: number, polarVelocity: number, dt: number) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const angular = clamp(Number.isFinite(azimuthVelocity) ? azimuthVelocity : 0, 4);
      const polar = clamp(Number.isFinite(polarVelocity) ? polarVelocity : 0, 3);
      advance(yaw, clamp(-angular * .085, .17), 8, .62, dt);
      advance(lean, clamp(-angular * .020, .045), 9, .60, dt);
      advance(pitch, clamp(polar * .025, .035), 8, .68, dt);
      advance(ears, -lean.position * 1.7 - yaw.velocity * .055, 12, .48, dt);
      advance(leaf, -lean.position * 1.4 - yaw.velocity * .07, 9, .44, dt);
      advance(arms, lean.position * .6 + yaw.velocity * .025, 8, .68, dt);
    },
    get settling() { return springs.some(spring => Math.abs(spring.position) > .0001 || Math.abs(spring.velocity) > .0005); },
  };
}
