import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ server: vi.fn() }))
vi.mock('../../runtime/rpc/server/runtime-rpc', () => ({ OrcaRuntimeRpcServer: h.server }))

import { createOrcadRuntimeRpcServer } from './orcad-runtime-rpc'

describe('createOrcadRuntimeRpcServer', () => {
  it('writes the orcad role to the runtime file', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orcad-runtime-role-'))
    createOrcadRuntimeRpcServer({} as never, userDataPath, {} as never, '127.0.0.1')
    expect(h.server).toHaveBeenCalledWith(expect.objectContaining({ role: 'orcad', userDataPath }))
  })
})
