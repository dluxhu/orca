import { join } from 'node:path'

export type RuntimeTransportMetadata =
  | {
      kind: 'unix'
      endpoint: string
    }
  | {
      kind: 'named-pipe'
      endpoint: string
    }
  | {
      kind: 'websocket'
      endpoint: string
    }

/** The process that owns a runtime file: the desktop app, an Electron `orca serve`, or orcad. */
export type RuntimeRole = 'app' | 'serve' | 'orcad'

export type RuntimeMetadata = {
  runtimeId: string
  pid: number
  transports: RuntimeTransportMetadata[]
  authToken: string | null
  startedAt: number
  /** Absent in files of older versions. */
  role?: RuntimeRole
  /** The userData folder of the owner. Absent in files of older versions. */
  userDataPath?: string
}

// Read both legacy singular transport and the newer transports array for older CLI metadata files.
export function findTransport(
  metadata: RuntimeMetadata,
  ...kinds: RuntimeTransportMetadata['kind'][]
): RuntimeTransportMetadata | null {
  const transports = metadata.transports
  if (transports && Array.isArray(transports)) {
    return transports.find((t) => kinds.includes(t.kind)) ?? null
  }
  // Why: backward compatibility with pre-transports-array metadata files.
  const legacy = (metadata as Record<string, unknown>).transport as RuntimeTransportMetadata | null
  if (legacy && kinds.includes(legacy.kind)) {
    return legacy
  }
  return null
}

export const PRIMARY_RUNTIME_METADATA_FILE = 'orca-runtime.json'

export function getRuntimeMetadataPath(userDataPath: string): string {
  return join(userDataPath, PRIMARY_RUNTIME_METADATA_FILE)
}
