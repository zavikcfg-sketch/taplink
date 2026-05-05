import type { Profile, ProfileLink } from '../types/profile'
import { getTelegramInitData } from './telegramInit'

const base = (path: string) => `/api/public/${encodeURIComponent(path)}`

export function writeHeaders(extra?: HeadersInit): HeadersInit {
  const h = extra ? new Headers(extra) : new Headers()
  const init = getTelegramInitData()
  if (init) h.set('X-Telegram-Init-Data', init)
  return h
}

function parseProfile(data: unknown): Profile | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (typeof o.slug !== 'string') return null
  const linksRaw = o.links
  const links: ProfileLink[] = Array.isArray(linksRaw)
    ? linksRaw
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((l) => ({
          id: String(l.id ?? '').slice(0, 40),
          title: String(l.title ?? '').slice(0, 60),
          url: String(l.url ?? '').slice(0, 2000),
        }))
    : []
  let linkClicks: Record<string, number> | undefined
  const lc = o.linkClicks
  if (lc && typeof lc === 'object' && !Array.isArray(lc)) {
    linkClicks = {}
    for (const [k, v] of Object.entries(lc)) {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) continue
      linkClicks[k.slice(0, 40)] = Math.floor(n)
    }
    if (Object.keys(linkClicks).length === 0) linkClicks = undefined
  }
  return {
    slug: o.slug,
    displayName: String(o.displayName ?? ''),
    bio: String(o.bio ?? ''),
    links,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : undefined,
    hasAvatar: typeof o.hasAvatar === 'boolean' ? o.hasAvatar : undefined,
    hasBackground: typeof o.hasBackground === 'boolean' ? o.hasBackground : undefined,
    backgroundKind:
      o.backgroundKind === 'video' || o.backgroundKind === 'image'
        ? o.backgroundKind
        : undefined,
    linkClicks,
  }
}

export async function fetchPublicProfile(slug: string): Promise<Profile | null> {
  const r = await fetch(base(slug), { headers: { Accept: 'application/json' } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Профиль: ${r.status}`)
  return parseProfile(await r.json())
}

export async function savePublicProfile(
  slug: string,
  body: Pick<Profile, 'displayName' | 'bio' | 'links'>,
): Promise<Profile> {
  const r = await fetch(base(slug), {
    method: 'PUT',
    headers: writeHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify({
      displayName: body.displayName,
      bio: body.bio,
      links: body.links,
    }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(t || `Сохранение: ${r.status}`)
  }
  const p = parseProfile(await r.json())
  if (!p) throw new Error('Некорректный ответ сервера')
  return p
}

export async function uploadAvatarToServer(slug: string, blob: Blob): Promise<void> {
  const fd = new FormData()
  fd.append('file', blob, 'avatar.jpg')
  const r = await fetch(`${base(slug)}/avatar`, {
    method: 'POST',
    headers: writeHeaders(),
    body: fd,
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(t || `Аватар: ${r.status}`)
  }
}

export async function deleteAvatarOnServer(slug: string): Promise<void> {
  const r = await fetch(`${base(slug)}/avatar`, {
    method: 'DELETE',
    headers: writeHeaders(),
  })
  if (!r.ok && r.status !== 404) {
    const t = await r.text()
    throw new Error(t || `Удаление аватара: ${r.status}`)
  }
}

export function publicAvatarUrl(slug: string, cacheBust?: string): string {
  const q = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : ''
  return `${base(slug)}/avatar${q}`
}

export async function uploadBackgroundToServer(slug: string, blob: Blob): Promise<void> {
  const fd = new FormData()
  const ext =
    blob.type === 'video/webm'
      ? 'webm'
      : blob.type === 'video/quicktime'
        ? 'mov'
        : blob.type === 'video/mp4'
          ? 'mp4'
          : blob.type === 'image/png'
            ? 'png'
            : blob.type === 'image/webp'
              ? 'webp'
              : blob.type === 'image/gif'
                ? 'gif'
                : 'jpg'
  fd.append('file', blob, `background.${ext}`)
  const r = await fetch(`${base(slug)}/background`, {
    method: 'POST',
    headers: writeHeaders(),
    body: fd,
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(t || `Фон: ${r.status}`)
  }
}

export async function deleteBackgroundOnServer(slug: string): Promise<void> {
  const r = await fetch(`${base(slug)}/background`, {
    method: 'DELETE',
    headers: writeHeaders(),
  })
  if (!r.ok && r.status !== 404) {
    const t = await r.text()
    throw new Error(t || `Удаление фона: ${r.status}`)
  }
}

export function publicBackgroundUrl(slug: string, cacheBust?: string): string {
  const q = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : ''
  return `${base(slug)}/background${q}`
}

/** Подсчёт перехода по кнопке (без await в UI). */
export function recordLinkClick(slug: string, linkId: string): void {
  const id = linkId.slice(0, 40)
  if (!id) return
  void fetch(`${base(slug)}/click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ linkId: id }),
  }).catch(() => {})
}
