// Python and numpy behaviour that the port of dock-icon-badger needs.

export type Pt = [number, number]

/** Python `round()`: half to even. */
export function pyRound(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** numpy `linspace(start, stop, num)`. */
export function linspace(start: number, stop: number, num: number): number[] {
  const step = (stop - start) / (num - 1)
  return Array.from({ length: num }, (_, i) => (i === num - 1 ? stop : i * step + start))
}

/** numpy `interp` for increasing xp. */
export function interp(x: number, xp: readonly number[], fp: readonly number[]): number {
  if (x <= xp[0]) {
    return fp[0]
  }
  for (let i = 1; i < xp.length; i++) {
    if (x <= xp[i]) {
      return fp[i - 1] + ((x - xp[i - 1]) * (fp[i] - fp[i - 1])) / (xp[i] - xp[i - 1])
    }
  }
  return fp.at(-1)
}

export const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const ss_ = (e: number): number => clip(e + 0.5, 0, 1)
/** numpy `astype("uint8")` after a clip to 0..255. */
export const u8 = (v: number): number => Math.trunc(clip(v, 0, 255))
