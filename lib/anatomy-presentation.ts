/** Presentation offsets are glTF Y-up coordinates, independent of the authored anatomy. */
export type PresentationPhase = 0 | 1 | 2;
type Offset = readonly [number, number, number];
export const COAT_OFFSET: Offset = [-5.2, 0, 0];
export const REVEAL_DURATION = 1.15;
const GROUP_OFFSETS: Record<string, Offset> = {
  skin: COAT_OFFSET, bones: [0, 0, 0], muscles: [4.6, 0, -.15],
};
const BRAIN_OFFSET: Offset = [0, 1.55, 1.85];
const HEART_OFFSET: Offset = [-.55, .35, 3.7];
const PART_OFFSETS: Record<string, Offset> = {
  brain: BRAIN_OFFSET, brain_white_matter: BRAIN_OFFSET,
  cerebellum: BRAIN_OFFSET, brainstem: BRAIN_OFFSET,
  heart: HEART_OFFSET, coronary_arteries: HEART_OFFSET,
  lung_L: [-1.75, .3, 2.7], lung_R: [1.75, .3, 2.7],
  liver: [1.65, -.2, 3.4], gallbladder: [1.65, -.2, 3.4], biliary_tree: [1.65, -.2, 3.4],
  arteries_network: [-1.1, 0, -2.5], veins_network: [1.1, 0, -2.5],
  nervous_network: [0, 0, -3.5],
};

export function presentationOffset(id: string, group: string | undefined, authored: Offset): Offset {
  // Unknown/legacy assets retain their authored diagram rather than being guessed.
  if (!group) return authored;
  return PART_OFFSETS[id] ?? GROUP_OFFSETS[group] ?? authored;
}

export function presentationPhase(group: string | undefined): PresentationPhase {
  return group === 'skin' ? 0 : group === 'muscles' ? 1 : 2;
}

export function museumEase(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const STARTS = [0, .15, .275] as const;
const ENDS = [.4, .65, .9] as const;
/** The slider uses a single short retarget, not the staggered entrance. */
export function revealProgress(seconds: number, phase: PresentationPhase, entrance: boolean) {
  return entrance
    ? museumEase((seconds - STARTS[phase]) / (ENDS[phase] - STARTS[phase]))
    : museumEase(seconds / .3);
}
