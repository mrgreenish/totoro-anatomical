export type AnatomyMode = 'exterior' | 'split' | 'exploded';
export type AnatomyVariant = 'male' | 'female';
export type AnatomySystem = 'skin' | 'muscles' | 'bones' | 'organs' | 'arteries' | 'veins' | 'nerves' | 'reproductive';
export type CutAxis = 'x' | 'y' | 'z';
export type AnatomyPart = { id: string; label: string; systems: AnatomySystem[]; description: string; variant?: AnatomyVariant };
export type BrainViewState = { available: boolean; status: 'closed' | 'loading' | 'open' | 'error' };
export type OrganStudy = 'brain' | 'heart' | 'eye';
export type AnatomyState = {
  mode: AnatomyMode;
  variant: AnatomyVariant;
  status: 'idle' | 'loading' | 'ready' | 'error';
  cut: { axis: CutAxis; position: number; flipped: boolean };
  explosion: number;
  visibleSystems: AnatomySystem[];
  selectedId: string | null;
  parts: AnatomyPart[];
  brainView: BrainViewState;
  heartView: BrainViewState;
  eyeView: BrainViewState;
};
export const SYSTEMS: { id: AnatomySystem; label: string; color: string }[] = [
  { id: 'skin', label: 'Skin & coat', color: '#9caaa0' },
  { id: 'muscles', label: 'Muscles', color: '#ac5143' },
  { id: 'bones', label: 'Skeleton', color: '#c5b58a' },
  { id: 'organs', label: 'Organs', color: '#bd806b' },
  { id: 'reproductive', label: 'Reproductive system', color: '#b78d91' },
  { id: 'arteries', label: 'Arteries', color: '#b84040' },
  { id: 'veins', label: 'Veins', color: '#497caa' },
  { id: 'nerves', label: 'Nervous system', color: '#bba148' },
];
export const clamp01 = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : .5;
export function defaultAnatomyState(): AnatomyState {
  return { mode: 'exterior', variant: 'male', status: 'idle', cut: { axis: 'x', position: .5, flipped: false },
    explosion: .65, visibleSystems: SYSTEMS.map(s => s.id), selectedId: null, parts: [],
    brainView: { available: false, status: 'closed' }, heartView: { available: false, status: 'closed' }, eyeView: { available: false, status: 'closed' } };
}
export function systemVisible(systems: AnatomySystem[], visible: AnatomySystem[]) {
  return systems.some(system => visible.includes(system));
}
export function partVisible(part: AnatomyPart, state: Pick<AnatomyState, 'variant' | 'visibleSystems'>) {
  return (!part.variant || part.variant === state.variant) && systemVisible(part.systems, state.visibleSystems);
}
export const CUT_BOUNDS: Record<CutAxis, [number, number]> = { x: [-2.1, 2.1], y: [-.1, 5.1], z: [-1.8, 1.3] };
export function cutCoordinate(axis: CutAxis, position: number) {
  const [min, max] = CUT_BOUNDS[axis];
  return min + (max - min) * clamp01(position);
}
export function explosionPosition(rest: readonly number[], offset: readonly number[], amount: number) {
  const value = clamp01(amount);
  return rest.map((position, i) => position + offset[i] * value);
}
export function fitDistance(width: number, height: number, depth: number, fov: number, aspect: number) {
  const tangent = Math.tan(fov * Math.PI / 360);
  return Math.max(height / (2 * tangent), width / (2 * tangent * Math.max(.15, aspect))) * 1.18 + depth * .5;
}
