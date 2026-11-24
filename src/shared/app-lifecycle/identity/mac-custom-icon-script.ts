// The AppleScript that gives a macOS bundle a Finder custom icon (NSWorkspace setIcon:forFile:).
// It writes the bundle's "Icon\r" file and its FinderInfo flag, not the signed contents.
// Inputs come from the environment: ORCA_APP_BUNDLE_PATH and ORCA_APP_ICON_PATH. The script reads
// them through NSProcessInfo: `system attribute` does not keep non-ASCII characters.
export const MAC_DOCK_ICON_SCRIPT = [
  'use framework "AppKit"',
  'use scripting additions',
  "set env to current application's NSProcessInfo's processInfo()'s environment()",
  `set appPath to (env's objectForKey:"ORCA_APP_BUNDLE_PATH") as text`,
  `set iconPath to (env's objectForKey:"ORCA_APP_ICON_PATH") as text`,
  "set image to current application's NSImage's alloc()'s initWithContentsOfFile:iconPath",
  'if image is missing value then error "Orca app icon image could not be loaded"',
  "set ok to current application's NSWorkspace's sharedWorkspace()'s setIcon:image forFile:appPath options:0",
  'if ok is false then error "Orca app icon could not be persisted"'
]
