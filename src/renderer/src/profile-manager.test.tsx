// @vitest-environment happy-dom

import { expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ apply: vi.fn(), listeners: [] as (() => void)[] }))

vi.mock('./assets/main.css', () => ({}))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: () => undefined }) }))
vi.mock('./components/profile-manager/ProfileManager', () => ({ ProfileManager: () => null }))
vi.mock('./app-shell/appearance/use-app-theme-paint', () => ({ applyStartupAppTheme: h.apply }))

it('follows a change of the system appearance after the start', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { settings: { getSync: () => null } }
  })
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_type: string, listener: () => void) => h.listeners.push(listener),
    removeEventListener: () => undefined
  })) as never
  await import('./profile-manager')
  expect(h.apply).toHaveBeenCalledTimes(1)
  for (const listener of h.listeners) {
    listener()
  }
  expect(h.apply).toHaveBeenCalledTimes(2)
  expect(h.apply).toHaveBeenLastCalledWith(null)
})
