import type { Profile, ProfileLink, ThemeId } from '../types/profile'
import { normalizeThemeId } from './themes'
import { RESERVED_SLUGS } from './reservedSlugs'

const PROFILE_KEY = 'taplink_profile_v1'
const IDB_NAME = 'taplink_style_media'
const IDB_STORE = 'blobs'
const AVATAR_KEY = 'avatar'
const BACKGROUND_KEY = 'background'

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase())
}

/** Латиница, цифры, дефис; 2–30 символов. */
export function isValidSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase()
  if (s.length < 2 || s.length > 30) return false
  if (isReservedSlug(s)) return false
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Profile
    if (!data || typeof data.slug !== 'string') return null
    if (!isValidSlug(data.slug)) return null
    const linksRaw: unknown[] = Array.isArray(data.links) ? (data.links as unknown[]) : []
    const links: ProfileLink[] = linksRaw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter((l) => typeof l.id === 'string')
      .map((l) => ({
        id: String(l.id).slice(0, 40),
        title: String(l.title ?? '').slice(0, 60),
        url: String(l.url ?? '').slice(0, 2000),
        hidden: l.hidden === true,
        visibleFrom:
          typeof l.visibleFrom === 'string' ? l.visibleFrom.slice(0, 40) : undefined,
        visibleUntil:
          typeof l.visibleUntil === 'string' ? l.visibleUntil.slice(0, 40) : undefined,
      }))
    return {
      slug: data.slug.trim().toLowerCase(),
      displayName: String(data.displayName ?? '').slice(0, 80),
      bio: String(data.bio ?? '').slice(0, 500),
      links,
      themeId: normalizeThemeId(typeof data.themeId === 'string' ? data.themeId : undefined),
    }
  } catch {
    return null
  }
}

export function saveProfile(profile: Profile): void {
  const themeId: ThemeId = normalizeThemeId(profile.themeId)
  const normalized: Profile = {
    ...profile,
    slug: profile.slug.trim().toLowerCase(),
    displayName: profile.displayName.trim(),
    bio: profile.bio.trim(),
    themeId,
    links: profile.links.map((l) => ({
      ...l,
      title: l.title.trim(),
      url: l.url.trim(),
      hidden: l.hidden === true,
      visibleFrom: l.visibleFrom?.trim() || undefined,
      visibleUntil: l.visibleUntil?.trim() || undefined,
    })),
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized))
}

/** После удаления аккаунта на сервере — очистить черновик и медиа в браузере. */
export async function clearAllLocalProfile(): Promise<void> {
  try {
    localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* ignore */
  }
  await saveAvatarBlob(null).catch(() => {})
  await saveBackgroundBlob(null).catch(() => {})
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => reject(req.error ?? new Error('IDB open'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

export async function loadAvatarBlob(): Promise<Blob | null> {
  try {
    const db = await openMediaDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const r = tx.objectStore(IDB_STORE).get(AVATAR_KEY)
      r.onerror = () => reject(r.error)
      r.onsuccess = () => {
        const v = r.result
        resolve(v instanceof Blob ? v : null)
      }
    })
  } catch {
    return null
  }
}

export async function saveAvatarBlob(blob: Blob | null): Promise<void> {
  const db = await openMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    if (blob) store.put(blob, AVATAR_KEY)
    else store.delete(AVATAR_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB write'))
  })
}

export async function loadBackgroundBlob(): Promise<Blob | null> {
  try {
    const db = await openMediaDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const r = tx.objectStore(IDB_STORE).get(BACKGROUND_KEY)
      r.onerror = () => reject(r.error)
      r.onsuccess = () => {
        const v = r.result
        resolve(v instanceof Blob ? v : null)
      }
    })
  } catch {
    return null
  }
}

export async function saveBackgroundBlob(blob: Blob | null): Promise<void> {
  const db = await openMediaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    if (blob) store.put(blob, BACKGROUND_KEY)
    else store.delete(BACKGROUND_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB write'))
  })
}
