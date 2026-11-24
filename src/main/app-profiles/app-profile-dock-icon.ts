// The Dock icon of a profile app. See docs/fork/profiles-design.md, section 8.
import { getAppProfile } from './app-profile'

/**
 * True when a profile app must keep its own bundle icon: the icon choice gives the default Orca
 * icon (the default choice, or an imported icon that is missing).
 */
export function keepsBundleIcon(iconPath: string, builtIn: { classic: string }): boolean {
  return getAppProfile() !== null && iconPath === builtIn.classic
}
