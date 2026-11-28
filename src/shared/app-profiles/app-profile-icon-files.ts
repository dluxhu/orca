// The icon files in a profile's userData, and the badge colour. No Node imports: the Profile
// Manager renderer uses them.

/** A copy of the profile icon, so the icon does not depend on the app. */
export const APP_PROFILE_ICON_FILE = 'profile-icon.icns'
/** A copy of an uploaded badge as PNG, next to the icon. The Edit form starts from it. */
export const APP_PROFILE_BADGE_FILE = 'profile-icon-badge.png'
/** A copy of an uploaded base icon as PNG, next to the icon. The Edit form starts from it. */
export const APP_PROFILE_BASE_FILE = 'profile-icon-base.png'
/** The colour of a badge character without its own colour. */
export const APP_PROFILE_BADGE_COLOR = '#0f172a'
/** The swatches of the badge character colour. The first is the default. */
export const APP_PROFILE_BADGE_SWATCHES = [
  APP_PROFILE_BADGE_COLOR,
  '#dc2626',
  '#ea580c',
  '#16a34a',
  '#2563eb',
  '#9333ea'
] as const
/** The menu-bar (tray) template of the profile icon: a 2x PNG, black with alpha. */
export const APP_PROFILE_MENU_BAR_FILE = 'profile-menu-bar@2x.png'
