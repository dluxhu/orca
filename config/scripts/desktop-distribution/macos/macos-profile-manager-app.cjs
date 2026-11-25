// Fork patch: the nested "Orca Profile Manager" app. See docs/fork/profiles-design.md, section 4.
const { execFileSync } = require('node:child_process')
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync
} = require('node:fs')
const { join } = require('node:path')
const { giveMacExecutableUniqueUuid } = require('./macos-executable-uuid.cjs')

const PROFILE_MANAGER_APP = 'Orca Profile Manager'
// afterPack signs the nested app. electron-builder must not sign it again through its links.
const macProfileManagerSignIgnore = [`/Contents/Applications/${PROFILE_MANAGER_APP}\\.app(/|$)`]
const ELECTRON_FRAMEWORK = 'Electron Framework.framework'
// From <nested>/Contents/<folder>/<entry> up to <outer>/Contents.
const TO_OUTER_CONTENTS = join('..', '..', '..', '..')

/**
 * Makes <app>/Contents/Applications/Orca Profile Manager.app from the packed app, before the
 * outer app is signed. Copies: the main executable, the helper apps and the Electron framework
 * (a linked framework stops every child process, section 12, U4). Links: all other frameworks and
 * all resources, relative, so they stay inside the outer bundle. Returns the nested app's path.
 */
async function buildMacProfileManagerApp({
  appPath,
  appId,
  executable,
  signCode,
  signBundle,
  run = execFileSync
}) {
  const outer = join(appPath, 'Contents')
  const bundle = join(outer, 'Applications', `${PROFILE_MANAGER_APP}.app`)
  const contents = join(bundle, 'Contents')
  const bundleId = `${appId}.profile-manager`
  rmSync(bundle, { recursive: true, force: true })
  for (const folder of ['MacOS', 'Frameworks', 'Resources']) {
    mkdirSync(join(contents, folder), { recursive: true })
  }

  const plist = join(contents, 'Info.plist')
  copyFileSync(join(outer, 'Info.plist'), plist)
  run('/usr/bin/plutil', ['-convert', 'xml1', plist])
  const plutil = (...args) => run('/usr/bin/plutil', [...args, plist])
  plutil('-replace', 'CFBundleIdentifier', '-string', bundleId)
  plutil('-replace', 'CFBundleDisplayName', '-string', PROFILE_MANAGER_APP)
  plutil('-replace', 'OrcaAppRole', '-string', 'profile-manager')
  // The Manager takes no orca: links and no documents yet (section 5). The asar fuse is off.
  for (const key of ['CFBundleURLTypes', 'CFBundleDocumentTypes', 'ElectronAsarIntegrity']) {
    if (readFileSync(plist, 'utf8').includes(`<key>${key}</key>`)) {
      plutil('-remove', key)
    }
  }
  if (existsSync(join(outer, 'PkgInfo'))) {
    copyFileSync(join(outer, 'PkgInfo'), join(contents, 'PkgInfo'))
  }

  const mainExecutable = join(contents, 'MacOS', executable)
  copyFileSync(join(outer, 'MacOS', executable), mainExecutable)
  giveMacExecutableUniqueUuid(mainExecutable, bundleId)

  const ownCode = []
  for (const entry of readdirSync(join(outer, 'Frameworks'))) {
    const to = join(contents, 'Frameworks', entry)
    if (entry.endsWith('.app') || entry === ELECTRON_FRAMEWORK) {
      run('/usr/bin/ditto', [join(outer, 'Frameworks', entry), to])
      ownCode.push(to)
    } else {
      symlinkSync(join(TO_OUTER_CONTENTS, 'Frameworks', entry), to)
    }
  }
  for (const entry of readdirSync(join(outer, 'Resources'))) {
    symlinkSync(join(TO_OUTER_CONTENTS, 'Resources', entry), join(contents, 'Resources', entry))
  }

  // Inner code first: a bundle seal needs signed nested code.
  for (const path of ownCode) {
    await signCode(path)
  }
  await signBundle(bundle)
  return bundle
}

module.exports = { buildMacProfileManagerApp, macProfileManagerSignIgnore }
