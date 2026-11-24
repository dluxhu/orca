import '../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import '../../orchestration/db/contract-constants'
import '../../orchestration/db/messages/mailbox-routing-page'
import '../../orchestration/db/dispatch-row-writer'
import '../../orchestration/db/attempt-outcome-projection'
import { STATUS_METHODS } from '../methods/host-management/status'
import { readRuntimeMetadata } from './runtime-metadata'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

describe('the runtime file', () => {
  it.each([[undefined, 'app'] as const, ['serve', 'serve'] as const, ['orcad', 'orcad'] as const])(
    'names its owner: role %s gives %s, with the userData folder',
    async (role, written) => {
      const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-role-'))
      const server = new OrcaRuntimeRpcServer({
        runtime: new OrcaRuntimeService(),
        methods: STATUS_METHODS,
        userDataPath,
        ...(role ? { role } : {})
      })
      await server.start()
      try {
        expect(readRuntimeMetadata(userDataPath)).toMatchObject({
          pid: process.pid,
          role: written,
          userDataPath
        })
      } finally {
        await server.stop()
      }
    }
  )
})
