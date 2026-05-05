import type { ProfileLink } from '../types/profile'

/** Как на сервере: скрытые и вне окна по датам не показываем гостям. */
export function filterLinksForPublic(links: ProfileLink[]): ProfileLink[] {
  const now = Date.now()
  return links.filter((l) => {
    if (l.hidden) return false
    if (l.visibleFrom?.trim()) {
      const t = Date.parse(l.visibleFrom)
      if (Number.isFinite(t) && now < t) return false
    }
    if (l.visibleUntil?.trim()) {
      const t = Date.parse(l.visibleUntil)
      if (Number.isFinite(t) && now > t) return false
    }
    return true
  })
}
