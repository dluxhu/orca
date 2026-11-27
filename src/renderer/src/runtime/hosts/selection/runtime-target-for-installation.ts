import type { AppState } from '@/store/types'
import type { RuntimeStatuses } from '@/store/slices/runtime-status/views/runtime-status-owner'
import {
  buildCrossStoreLineageView,
  OWN_LINEAGE_STORE_KEY
} from '../../../../../shared/worktree/lineage/cross-store-lineage-resolution'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/** This window's connection to the Orca with this installation id, by the identity each host last
 *  verified; null when the window has none. */
export function runtimeTargetForInstallation(
  state: Pick<AppState, 'ownLineageInstallationId' | 'removedRuntimeEnvironmentIds'>,
  statuses: RuntimeStatuses,
  installationId: string
): RuntimeClientTarget | null {
  const view = buildCrossStoreLineageView({
    own: { installationId: state.ownLineageInstallationId, crossStoreLineageByChildKey: undefined },
    statusByEnvironmentId: statuses,
    removedEnvironmentIds: state.removedRuntimeEnvironmentIds,
    crossStoreLineageByEnvironmentId: new Map()
  })
  for (const [storeKey, store] of view) {
    if (store.installationId === installationId) {
      return storeKey === OWN_LINEAGE_STORE_KEY
        ? { kind: 'local' }
        : { kind: 'environment', environmentId: storeKey }
    }
  }
  return null
}
