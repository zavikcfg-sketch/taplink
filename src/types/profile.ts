export type ThemeId = 'purple' | 'ocean' | 'sunset' | 'mono' | 'light'

export type ProfileLink = {
  id: string
  title: string
  url: string
  hidden?: boolean
  /** ISO или datetime-local строка с сервера */
  visibleFrom?: string
  visibleUntil?: string
}

export type Profile = {
  slug: string
  displayName: string
  bio: string
  links: ProfileLink[]
  themeId?: ThemeId
  /** ISO с сервера */
  updatedAt?: string
  hasAvatar?: boolean
  hasBackground?: boolean
  backgroundKind?: 'image' | 'video'
  linkClicks?: Record<string, number>
}
