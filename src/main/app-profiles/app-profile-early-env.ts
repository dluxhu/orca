// Imported first by the main process entry: every later module reads the profile's folders.
import { applyAppProfileHomes } from '../../shared/app-profiles/app-profile-homes'
import { getAppProfile } from './app-profile'

let userDataPath: string | null = null
try {
  userDataPath = getAppProfile()?.userDataPath ?? null
} catch {
  // The preflight reports a profile that does not resolve.
}
// The default app also clears profile folders inherited from a profile's terminal.
applyAppProfileHomes(userDataPath, process.env)
