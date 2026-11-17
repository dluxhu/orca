// The "Orca @dLux" fork identity. Every fork-specific name comes from here. See docs/fork/PATCHES.md.
export const FORK_IDENTITY = {
  productName: 'Orca @dLux',
  // The `.dlux` suffix keeps checks for `com.stablyai.orca.*` children working.
  appId: 'com.stablyai.orca.dlux',
  // The GitHub repository whose releases feed the auto-updater.
  releaseRepo: 'dluxhu/orca'
} as const

/** Puts the fork name in place of the word `Orca` in a visible label, such as "About Orca". */
export function withForkName(label: string): string {
  return label.replace(/\bOrca\b/g, FORK_IDENTITY.productName)
}
