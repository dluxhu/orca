// Fork patch: a profile app keeps its own Dock icon. See docs/fork/profiles-design.md, section 8.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  own: null as { tag: string } | null,
  setIcon: vi.fn(),
  image: { isEmpty: () => false, tag: 'png' },
  createFromPath: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, dock: { setIcon: h.setIcon }, getPath: () => '/x/MacOS/exe' },
  BrowserWindow: { getAllWindows: () => [] },
  nativeImage: { createFromPath: h.createFromPath, createEmpty: () => ({ isEmpty: () => true }) }
}))
vi.mock('../../../../resources/icon.png?asset', () => ({ default: '/classic.png' }))
vi.mock('../../../../resources/icon-dev.png?asset', () => ({ default: '/classic-dev.png' }))
vi.mock('../../../../resources/icon-dev-mac.png?asset', () => ({ default: '/classic-dev-mac.png' }))
vi.mock('../../../../resources/app-icons/orca-watercolor.png?asset', () => ({ default: '/w.png' }))
vi.mock('../../../../resources/app-icons/orca-watercolor-mac.png?asset', () => ({
  default: '/wm.png'
}))
vi.mock('../../../../resources/app-icons/orca-watercolor-mac.png?asset&asarUnpack', () => ({
  default: '/wmd.png'
}))
vi.mock('../../../../resources/app-icons/orca-blue.png?asset', () => ({ default: '/b.png' }))
vi.mock('../../../../resources/app-icons/orca-blue.png?asset&asarUnpack', () => ({
  default: '/bd.png'
}))
vi.mock('./custom-app-icon', () => ({
  getCustomAppIconPath: () => '/custom.png',
  getCustomAppIconRevision: () => 1,
  hasCustomAppIcon: () => false
}))
vi.mock('../../app-profiles/app-profile-dock-icon', () => ({
  ownDockIcon: () => h.own,
  ownIconPath: () => '/data/work/profile-icon.icns'
}))

import { applyAppIcon, persistMacDockIcon } from './app-icon'

beforeEach(() => {
  vi.clearAllMocks()
  h.createFromPath.mockReturnValue(h.image)
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
})

const OWN = { tag: 'own bundle icon' }

describe('applyAppIcon in a profile app', () => {
  it('shows its own bundle icon for the default choice and a missing imported icon', () => {
    h.own = OWN
    applyAppIcon('classic')
    applyAppIcon('custom')
    expect(h.setIcon.mock.calls).toEqual([[OWN], [OWN]])
  })

  it('still shows a built-in icon that the profile chose', () => {
    h.own = OWN
    applyAppIcon('blue')
    expect(h.setIcon).toHaveBeenCalledWith(h.image)
  })

  it('shows the default icon in the default app', () => {
    h.own = null
    applyAppIcon('classic')
    expect(h.setIcon).toHaveBeenCalledWith(h.image)
  })

  it.each(['classic', 'custom'])(
    'puts the profile Finder icon back when %s is saved, and sets its own Dock icon',
    async (choice) => {
      h.own = OWN
      const execFile = vi.fn((...args: unknown[]) => {
        ;(args.find((arg) => typeof arg === 'function') as (e: null) => void)(null)
        return {}
      })
      persistMacDockIcon(choice, {
        platform: 'darwin',
        isDevApp: false,
        appBundlePath: '/Apps/Work.app',
        execFile: execFile as never
      })
      await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(1))
      expect(h.setIcon).toHaveBeenCalledWith(OWN)
      // Only the custom icon script runs, with the kept icon; no clear and no xattr.
      const [file, , options] = execFile.mock.calls[0] as [
        string,
        string[],
        { env: NodeJS.ProcessEnv }
      ]
      expect(file).toBe('/usr/bin/osascript')
      expect(options.env.ORCA_APP_ICON_PATH).toBe('/data/work/profile-icon.icns')
      expect(options.env.ORCA_APP_BUNDLE_PATH).toBe('/Apps/Work.app')
    }
  )

  it('clears an old custom icon in the default app, as upstream does', async () => {
    h.own = null
    const execFile = vi.fn((...args: unknown[]) => {
      ;(args.find((arg) => typeof arg === 'function') as (e: null) => void)(null)
      return {}
    })
    persistMacDockIcon('classic', {
      platform: 'darwin',
      isDevApp: false,
      appBundlePath: '/Apps/Orca.app',
      execFile: execFile as never
    })
    await vi.waitFor(() => expect(execFile).toHaveBeenCalled())
  })
})
