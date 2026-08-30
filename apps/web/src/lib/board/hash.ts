/**
 * One hash for everything the chamber seeds off a run's id.
 *
 * FNV-1a over the id, which is all this needs to be: a stable, well-mixed
 * number per run. A place in a band (`galaxy.ts`) and a set of ring tilts
 * (`orbit.ts`) both come from it, so a run looks the same on the board, on its
 * own page and after every rebuild without anything having to remember it.
 */

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * MurmurHash3's finaliser. FNV-1a is fine over a whole id and poor at the
 * tail: two strings that differ only in their last character come out a few
 * hundred apart, which is no difference at all once scaled to [0, 1). This
 * spreads that difference over every bit.
 */
function mix(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * `count` uniforms in [0, 1) from one id.
 *
 * The first two are the halves of the id's own hash, so `galaxy.ts` draws
 * exactly what it always drew. Past two, each draw rehashes the id with its
 * index and mixes the result, which keeps every draw well apart from every
 * other — tested, because the unmixed version was not.
 */
export function uniforms(id: string, count: number): number[] {
  const out: number[] = [];
  const h = fnv1a(id);
  if (count > 0) out.push((h & 0xffff) / 0x10000);
  if (count > 1) out.push(((h >>> 16) & 0xffff) / 0x10000);
  for (let i = 2; i < count; i += 1) {
    out.push(mix(fnv1a(`${id}:${i}`)) / 0x100000000);
  }
  return out;
}
