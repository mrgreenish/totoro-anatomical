/** A child-facing, schematic human eye. Distances use a 12 mm globe radius. */
export type EyeMode = 'surface' | 'cutaway' | 'retina';
export type EyeLesson = 'parts' | 'light' | 'focus' | 'color' | 'signal';
export type EyePart = 'cornea' | 'iris' | 'pupil' | 'lens' | 'ciliary' | 'retina' | 'fovea' | 'nerve' | 'sclera' | 'choroid' | 'fluid';
export type EyeViewOptions = {
  mode: EyeMode; lesson: EyeLesson; light: number; near: number; accommodate: boolean;
  wavelength: number; rods: boolean; cones: boolean; labels: boolean; part: EyePart;
};
export const defaultEyeOptions = (): EyeViewOptions => ({
  mode: 'surface', lesson: 'parts', light: 65, near: 0, accommodate: true,
  wavelength: 555, rods: true, cones: true, labels: true, part: 'iris',
});
const bounded = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
export function normalizeEyeOptions(value: EyeViewOptions): EyeViewOptions {
  return { ...value, light: bounded(value.light, 0, 100), near: bounded(value.near, 0, 100), wavelength: bounded(value.wavelength, 400, 700) };
}
export function eyeOptics(options: Pick<EyeViewOptions, 'light' | 'near' | 'accommodate'>) {
  const light = bounded(options.light, 0, 100) / 100;
  const near = bounded(options.near, 0, 100) / 100;
  const accommodation = options.accommodate ? near : 0;
  return {
    // Iris radius is 5.7 mm; the pupil diameter varies from about 2 to 7 mm.
    pupil: .09 + .20 * (1 - Math.sqrt(light)),
    lensDepth: .145 + .062 * accommodation,
    lensRadius: .365 - .026 * accommodation,
    ciliaryRadius: .485 - .046 * accommodation,
    // Without accommodation, a near object's focus would lie behind the retina.
    focusZ: -.925 - .64 * (near - accommodation),
    blur: near - accommodation,
    accommodation,
  };
}
/** Broad, overlapping illustrative sensitivities, not measured color matching data. */
export function photoreceptorResponse(wavelength: number) {
  const nm = bounded(wavelength, 400, 700);
  const response = (peak: number, width: number) => Math.exp(-.5 * ((nm - peak) / width) ** 2);
  return { s: response(420, 28), m: response(534, 43), l: response(564, 49), rod: response(498, 38) };
}
export function spectrumColor(wavelength: number): [number, number, number] {
  const w = bounded(wavelength, 400, 700);
  if (w < 440) return [(440 - w) / 40 * .6, .08, 1];
  if (w < 490) return [0, (w - 440) / 50, 1];
  if (w < 510) return [0, 1, (510 - w) / 20];
  if (w < 580) return [(w - 510) / 70, 1, 0];
  if (w < 645) return [1, (645 - w) / 65, 0];
  return [1, .035, .025];
}
export const EYE_PARTS: { id: EyePart; label: string; nickname: string; text: string }[] = [
  { id: 'cornea', label: 'Cornea & tears', nickname: 'The clear window', text: 'Light first passes through a thin tear film and this clear dome. The cornea does most of the bending that helps focus light. Tears keep its surface smooth and moist.' },
  { id: 'iris', label: 'Iris', nickname: 'The light gate', text: 'This colored ring is made of tiny muscles. In bright light it makes the pupil smaller. In dim light it makes the pupil bigger to let more light in.' },
  { id: 'pupil', label: 'Pupil', nickname: 'A hole for light', text: 'The black circle is an opening, not a black piece of tissue! It looks dark because much of the light entering the eye is absorbed inside.' },
  { id: 'lens', label: 'Lens', nickname: 'The fine-focus helper', text: 'This clear, flexible lens changes shape. It becomes rounder for things nearby and flatter for things far away, bringing the picture into focus on the retina.' },
  { id: 'ciliary', label: 'Focusing muscle & fibers', nickname: 'The tiny focus team', text: 'For near objects, the ciliary muscle tightens its ring. The little fibers holding the lens loosen, letting the lens become rounder. For far objects, the muscle relaxes and the fibers pull the lens flatter.' },
  { id: 'retina', label: 'Retina', nickname: 'The light catcher', text: 'This delicate lining contains rods and cones. They respond to light and begin turning it into electrical messages. Light passes through other retinal cells before it reaches them.' },
  { id: 'fovea', label: 'Fovea', nickname: 'The sharpest spot', text: 'This tiny dip near the middle of the retina is packed with cones. Point your eyes at a word: the fovea helps you see its fine details. Its very center has no rods.' },
  { id: 'nerve', label: 'Optic nerve & blind spot', nickname: 'The message cable', text: 'Messages from retinal ganglion cells travel along the optic nerve to the brain. Where this cable leaves the eye there are no rods or cones: that is the blind spot.' },
  { id: 'sclera', label: 'Sclera', nickname: 'The strong white coat', text: 'This tough outer wall protects the eye and holds its shape. Muscles attached to it turn your eye so you can look around.' },
  { id: 'choroid', label: 'Choroid', nickname: 'The supply layer', text: 'Between the white coat and the retina is a dark layer full of blood vessels. It feeds the outer retina and absorbs stray light, like dark paint inside a camera.' },
  { id: 'fluid', label: 'The clear fluids', nickname: 'A window filled with jelly', text: 'Watery fluid at the front feeds the cornea and lens. Clear, jelly-like vitreous fills the large space behind the lens and helps the eye keep its shape.' },
];
export const EYE_SOURCES = [
  { label: 'National Eye Institute · How eyes work', url: 'https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/how-eyes-work' },
  { label: 'NEI · About the eye, for kids', url: 'https://www.nei.nih.gov/eye-health-information/healthy-vision/nei-for-kids/about-eye' },
  { label: 'Neuroscience · Focusing on the retina', url: 'https://www.ncbi.nlm.nih.gov/books/NBK11079/' },
];
