// The icon of a profile made before profile icons: docs/fork/profiles-design.md, section 8.
import { getAppProfile } from './app-profile'
import { forgetOwnDockIcon, ownDockIcon } from './app-profile-dock-icon'
import { runCli } from './profile-manager-cli'

/**
 * In a profile app without a kept icon: the CLI makes the name badge of the profile in the
 * background (`set-icon --if-missing`). `apply` runs when the CLI is done, to show the new icon.
 */
export function makeMissingProfileIcon(apply: () => void): void {
  const profile = getAppProfile()
  if (!profile || ownDockIcon()) {
    return
  }
  void runCli(['profiles', 'set-icon', profile.id, '--if-missing', '--json']).then((reply) => {
    if (!reply.ok) {
      console.warn('[profiles] cannot make the profile icon:', reply.error.message)
      return
    }
    forgetOwnDockIcon()
    apply()
  })
}
