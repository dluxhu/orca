// Fork patch: a profile app keeps its own Dock icon. See docs/fork/profiles-design.md, section 8.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  profile: null as { id: string } | null,
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
vi.mock('../../app-profiles/app-profile', () => ({ getAppProfile: () => h.profile }))

import { applyAppIcon } from './app-icon'

beforeEach(() => {
  vi.clearAllMocks()
  h.createFromPath.mockReturnValue(h.image)
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
})

describe('applyAppIcon in a profile app', () => {
  it('keeps the bundle icon for the default choice and a missing imported icon', () => {
    h.profile = { id: 'work' }
    applyAppIcon('classic')
    applyAppIcon('custom')
    expect(h.setIcon).not.toHaveBeenCalledWith(h.image)
  })

  it('still shows a built-in icon that the profile chose', () => {
    h.profile = { id: 'work' }
    applyAppIcon('blue')
    expect(h.setIcon).toHaveBeenCalledWith(h.image)
  })

  it('shows the default icon in the default app', () => {
    h.profile = null
    applyAppIcon('classic')
    expect(h.setIcon).toHaveBeenCalledWith(h.image)
  })
})
