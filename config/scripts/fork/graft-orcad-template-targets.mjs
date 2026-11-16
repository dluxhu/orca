#!/usr/bin/env node
// Fork release build: complete out/orcad-template with the native target slots of upstream's
// packaged app at the same version. The common files (the daemon and server JS) stay the fork's.
// Usage: node config/scripts/fork/graft-orcad-template-targets.mjs <upstream app>/Contents/Resources
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR
} from '../../../src/shared/orcad-artifacts.ts'
import { ORCAD_TEMPLATE_TARGETS } from '../../../src/shared/node-runtime-pin.ts'
import { verifyPackagedOrcadTemplate } from '../orcad-distribution/template/verify-packaged-orcad-template.cjs'

const root = resolve(import.meta.dirname, '../../..')
const outDir = join(root, 'out')
const templateDir = join(outDir, 'orcad-template')

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, ORCAD_TEMPLATE_MANIFEST_FILENAME), 'utf8'))
}

const upstreamResources = process.argv[2]
if (!upstreamResources || !existsSync(join(upstreamResources, 'orcad-template'))) {
  throw new Error('usage: graft-orcad-template-targets.mjs <upstream app>/Contents/Resources')
}
const upstreamTemplate = join(upstreamResources, 'orcad-template')
const upstream = readManifest(upstreamTemplate)
const manifest = readManifest(templateDir)

const grafted = []
for (const [target, source] of Object.entries(upstream.targets)) {
  if (Object.hasOwn(manifest.targets, target)) {
    continue
  }
  const destination = join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target)
  cpSync(join(upstreamTemplate, ORCAD_TEMPLATE_TARGETS_DIR, target), destination, {
    recursive: true
  })
  // Upstream packaging moves duplicate ripgrep and browser files out of the template.
  // Put them back, so the fork's own packaging step sees an unpackaged template.
  const { packagedRipgrep, packagedBrowser, browserName, browserSha256, ...entry } = source
  for (const [filename, digest] of Object.entries(entry.files)) {
    const path = join(destination, ...filename.split('/'))
    if (packagedRipgrep && filename.startsWith('ripgrep/') && !existsSync(path)) {
      copyFileSync(join(upstreamResources, ...filename.split('/')), path)
    }
    if (sha256(path) !== digest) {
      throw new Error(`${target}/${filename} does not match the upstream manifest`)
    }
  }
  manifest.targets[target] = packagedBrowser ? entry : { ...entry, browserName, browserSha256 }
  grafted.push(target)
}

writeFileSync(
  join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME),
  `${JSON.stringify(manifest, null, 2)}\n`
)
// Packaging checks every target, so check the same set here.
verifyPackagedOrcadTemplate(outDir, ORCAD_TEMPLATE_TARGETS)
process.stdout.write(`[graft-orcad-template-targets] ok: grafted ${grafted.join(', ')}\n`)
