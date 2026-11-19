import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  orcadRipgrepArtifact
} from '../../../src/shared/orcad-artifacts.ts'
import { writeOrcadTemplateTestFixture } from '../orcad-distribution/template/orcad-template-test-fixture.mjs'
import { graftOrcadTemplateTargets } from './graft-orcad-template-targets.mjs'

const require = createRequire(import.meta.url)
const {
  compactPackagedOrcadRipgrep
} = require('../orcad-distribution/template/compact-packaged-orcad-ripgrep.cjs')
const roots = []
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** Upstream's packaged Resources: every target, ripgrep moved out like upstream packaging does. */
async function upstreamResources(root) {
  const resourcesDir = join(root, 'upstream', 'Resources')
  const templateDir = await writeOrcadTemplateTestFixture(resourcesDir, { compat: true })
  const manifestPath = join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const [target, entry] of Object.entries(manifest.targets)) {
    const filename = orcadRipgrepArtifact(target)
    const bytes = Buffer.from(`${filename}:static binary`)
    await mkdir(dirname(join(resourcesDir, filename)), { recursive: true })
    await writeFile(join(resourcesDir, filename), bytes)
    await writeFile(join(templateDir, 'targets', target, filename), bytes)
    entry.files[filename] = hash(bytes)
  }
  await writeFile(manifestPath, JSON.stringify(manifest))
  compactPackagedOrcadRipgrep(resourcesDir)
  return resourcesDir
}

/** The fork's out dir after `build-orcad-template.mjs --targets darwin-arm64`. */
async function forkOutDir(root) {
  const outDir = join(root, 'out')
  const templateDir = await writeOrcadTemplateTestFixture(outDir)
  const manifestPath = join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const target of Object.keys(manifest.targets)) {
    if (target !== 'darwin-arm64') {
      delete manifest.targets[target]
      await rm(join(templateDir, 'targets', target), { recursive: true })
    }
  }
  await writeFile(manifestPath, JSON.stringify(manifest))
  return outDir
}

async function fixture() {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const root = await mkdtemp(join(tmpdir(), 'orca-graft-template-'))
  roots.push(root)
  return {
    outDir: await forkOutDir(root),
    upstreamResources: await upstreamResources(root),
    upstreamVersion: '1.4.259',
    version: '1.4.259'
  }
}

describe('graft-orcad-template-targets', () => {
  it('adds the missing targets and puts back the ripgrep files upstream moved out', async () => {
    const options = await fixture()
    const upstream = JSON.parse(
      await readFile(
        join(options.upstreamResources, 'orcad-template', ORCAD_TEMPLATE_MANIFEST_FILENAME),
        'utf8'
      )
    )
    expect(upstream.targets['linux-x64-glibc'].packagedRipgrep).toBe(true)

    const grafted = graftOrcadTemplateTargets(options)

    expect(grafted).not.toContain('darwin-arm64')
    expect(grafted).toContain('linux-x64-glibc217')
    const manifest = JSON.parse(
      await readFile(
        join(options.outDir, 'orcad-template', ORCAD_TEMPLATE_MANIFEST_FILENAME),
        'utf8'
      )
    )
    expect(manifest.targets['linux-x64-glibc'].packagedRipgrep).toBeUndefined()
    expect(
      await readFile(
        join(options.outDir, 'orcad-template/targets/linux-x64-glibc/ripgrep/linux-x64/rg'),
        'utf8'
      )
    ).toBe('ripgrep/linux-x64/rg:static binary')
  })

  it('refuses a target slot that does not match the upstream manifest', async () => {
    const options = await fixture()
    await writeFile(
      join(
        options.upstreamResources,
        'orcad-template/targets/linux-arm64-glibc/node_modules/node-pty/build/Release/pty.node'
      ),
      'tampered'
    )
    expect(() => graftOrcadTemplateTargets(options)).toThrow(
      'linux-arm64-glibc/node_modules/node-pty/build/Release/pty.node does not match the upstream manifest'
    )
  })

  it('refuses a restored ripgrep that does not match the upstream manifest', async () => {
    const options = await fixture()
    await writeFile(join(options.upstreamResources, 'ripgrep/linux-arm64/rg'), 'tampered')
    expect(() => graftOrcadTemplateTargets(options)).toThrow(
      'ripgrep/linux-arm64/rg does not match the upstream manifest'
    )
  })

  it('refuses an upstream app of another version', async () => {
    const options = await fixture()
    expect(() => graftOrcadTemplateTargets({ ...options, upstreamVersion: '1.4.260' })).toThrow(
      'upstream app is 1.4.260, but the fork base is 1.4.259'
    )
  })
})
