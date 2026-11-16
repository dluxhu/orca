import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adoptedTranscriptSourceObserver } from './adopted-transcript-source'

const SESSION = '0b7c1f2e-5d3a-4c8b-9e61-2f4a7d9c0e13'

describe('a Claude transcript adopted into a workspace', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(join(tmpdir(), 'orca-adopted-source-')))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  function validate(cwds: string[]) {
    const observer = adoptedTranscriptSourceObserver({
      agent: 'claude',
      filePath: `/store/projects/slug/${SESSION}.jsonl`,
      source: { providerSessionId: SESSION, workspaceCwd: workspace },
      maxSourceBytes: 1024 * 1024
    })
    for (const cwd of cwds) {
      observer.observe(JSON.stringify({ type: 'user', sessionId: SESSION, cwd }))
    }
    return observer.validate()
  }

  it('accepts a conversation that started elsewhere and later ran in this workspace', async () => {
    await expect(validate(['/workspace', '/other/repo', workspace])).resolves.toBeUndefined()
  })

  it('accepts a conversation whose last turn ran in a subfolder of this workspace', async () => {
    await expect(validate([workspace, join(workspace, 'sub')])).resolves.toBeUndefined()
  })

  it('refuses a conversation that never ran in this workspace', async () => {
    await expect(validate(['/workspace', '/other/repo'])).rejects.toThrow(
      'This conversation belongs to another directory.'
    )
  })
})
