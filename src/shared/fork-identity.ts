// The "Orca @dLux" fork identity. Every fork-specific name comes from here. See docs/fork/PATCHES.md.

// `build-release.sh --nightly` sets this to 'nightly' in the release commit. Patch branches keep 'stable'.
const FORK_CHANNEL = 'nightly' as 'stable' | 'nightly'
const NIGHTLY = FORK_CHANNEL === 'nightly'

export const FORK_IDENTITY = {
  productName: NIGHTLY ? 'Orca @dLux Nightly' : 'Orca @dLux',
  // The `.dlux` suffix keeps checks for `com.stablyai.orca.*` children working.
  appId: NIGHTLY ? 'com.stablyai.orca.dlux.nightly' : 'com.stablyai.orca.dlux',
  // The GitHub repository whose releases feed the auto-updater.
  releaseRepo: 'dluxhu/orca',
  // The userData folder under appData. null keeps official Orca's `orca` folder (shared profile).
  // The nightly build has its own folder, so it runs beside the stable fork.
  userDataName: NIGHTLY ? 'orca-dlux-nightly' : null
} as const

/** Puts the fork name in place of the word `Orca` in a visible label, such as "About Orca". */
export function withForkName(label: string): string {
  return label.replace(/\bOrca\b/g, FORK_IDENTITY.productName)
}
