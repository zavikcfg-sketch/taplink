export type ProfileLink = {
  id: string
  title: string
  url: string
}

export type Profile = {
  slug: string
  displayName: string
  bio: string
  links: ProfileLink[]
  /** ISO с сервера */
  updatedAt?: string
  hasAvatar?: boolean
  hasBackground?: boolean
  /** Тип загруженного фона (для публичной страницы) */
  backgroundKind?: 'image' | 'video'
  /** Счётчики переходов по id ссылки (с сервера) */
  linkClicks?: Record<string, number>
}
