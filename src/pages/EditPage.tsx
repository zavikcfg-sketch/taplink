import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Profile, ProfileLink } from '../types/profile'
import {
  deleteAvatarOnServer,
  deleteBackgroundOnServer,
  fetchPublicProfile,
  publicAvatarUrl,
  publicBackgroundUrl,
  savePublicProfile,
  uploadAvatarToServer,
  uploadBackgroundToServer,
} from '../lib/api'
import {
  isValidSlug,
  loadAvatarBlob,
  loadBackgroundBlob,
  loadProfile,
  saveAvatarBlob,
  saveBackgroundBlob,
  saveProfile,
} from '../lib/profileStorage'
import { isTelegramWebApp } from '../lib/telegramInit'
import './EditPage.css'

function newLink(): ProfileLink {
  return { id: crypto.randomUUID(), title: '', url: '' }
}

function applyProfile(
  p: Profile,
  setSlug: (v: string) => void,
  setDisplayName: (v: string) => void,
  setBio: (v: string) => void,
  setLinks: (v: ProfileLink[]) => void,
) {
  setSlug(p.slug)
  setDisplayName(p.displayName)
  setBio(p.bio)
  setLinks(p.links.length ? p.links : [newLink()])
}

type ServerMeta = {
  updatedAt?: string
  hasAvatar?: boolean
  hasBackground?: boolean
  backgroundKind?: 'image' | 'video'
}

export default function EditPage() {
  const slugId = useId()
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [links, setLinks] = useState<ProfileLink[]>([newLink()])
  const [serverMeta, setServerMeta] = useState<ServerMeta>({})
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [avatarBlobUrl, setAvatarBlobUrl] = useState<string | null>(null)
  const avatarBlobUrlRef = useRef<string | null>(null)
  const [bgRemoved, setBgRemoved] = useState(false)
  const [bgBlobUrl, setBgBlobUrl] = useState<string | null>(null)
  const bgBlobUrlRef = useRef<string | null>(null)
  const [bgKind, setBgKind] = useState<'image' | 'video' | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)
  const [syncOk, setSyncOk] = useState<string | null>(null)
  const [syncErr, setSyncErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bgFileRef = useRef<HTMLInputElement>(null)

  const setAvatarBlobUrlSafe = (url: string | null) => {
    if (avatarBlobUrlRef.current) {
      URL.revokeObjectURL(avatarBlobUrlRef.current)
      avatarBlobUrlRef.current = null
    }
    avatarBlobUrlRef.current = url
    setAvatarBlobUrl(url)
  }

  const setBgBlobUrlSafe = (url: string | null) => {
    if (bgBlobUrlRef.current) {
      URL.revokeObjectURL(bgBlobUrlRef.current)
      bgBlobUrlRef.current = null
    }
    bgBlobUrlRef.current = url
    setBgBlobUrl(url)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const local = loadProfile()
      let remote: Awaited<ReturnType<typeof fetchPublicProfile>> = null
      if (local?.slug && isValidSlug(local.slug)) {
        remote = await fetchPublicProfile(local.slug).catch(() => null)
        if (cancelled) return
        if (remote) {
          applyProfile(remote, setSlug, setDisplayName, setBio, setLinks)
          setServerMeta({
            updatedAt: remote.updatedAt,
            hasAvatar: remote.hasAvatar,
            hasBackground: remote.hasBackground,
            backgroundKind: remote.backgroundKind,
          })
        } else {
          applyProfile(local, setSlug, setDisplayName, setBio, setLinks)
        }
      } else if (local) {
        applyProfile(local, setSlug, setDisplayName, setBio, setLinks)
      }
      const blob = await loadAvatarBlob()
      if (cancelled) return
      if (blob) {
        const u = URL.createObjectURL(blob)
        avatarBlobUrlRef.current = u
        setAvatarBlobUrl(u)
      }

      const slugForBg = (remote?.slug ?? local?.slug ?? '').trim().toLowerCase()
      const bgLocal = await loadBackgroundBlob()
      if (cancelled) return
      if (bgLocal) {
        const u = URL.createObjectURL(bgLocal)
        bgBlobUrlRef.current = u
        setBgBlobUrl(u)
        setBgKind(bgLocal.type.startsWith('video/') ? 'video' : 'image')
      } else if (remote?.hasBackground && slugForBg && isValidSlug(slugForBg)) {
        setBgKind(remote.backgroundKind === 'video' ? 'video' : 'image')
      }
    })()
    return () => {
      cancelled = true
      if (avatarBlobUrlRef.current) {
        URL.revokeObjectURL(avatarBlobUrlRef.current)
        avatarBlobUrlRef.current = null
      }
      if (bgBlobUrlRef.current) {
        URL.revokeObjectURL(bgBlobUrlRef.current)
        bgBlobUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (document.querySelector('script[data-tg-web-app]')) return
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-web-app.js'
    s.async = true
    s.dataset.tgWebApp = '1'
    s.onload = () => {
      const tg = (
        window as Window & {
          Telegram?: { WebApp?: { ready: () => void; expand: () => void } }
        }
      ).Telegram?.WebApp
      tg?.ready()
      tg?.expand()
    }
    document.head.appendChild(s)
  }, [])

  const slugOk = slug.trim().toLowerCase()
  const slugValid = Boolean(slugOk && isValidSlug(slugOk))

  const avatarDisplay = useMemo(() => {
    if (avatarRemoved) return null
    if (avatarBlobUrl) return avatarBlobUrl
    if (serverMeta.hasAvatar && slugValid) return publicAvatarUrl(slugOk, serverMeta.updatedAt)
    return null
  }, [avatarRemoved, avatarBlobUrl, serverMeta.hasAvatar, serverMeta.updatedAt, slugValid, slugOk])

  const bgPreview = useMemo(() => {
    if (bgRemoved) return null
    if (bgBlobUrl) return bgBlobUrl
    if (serverMeta.hasBackground && slugValid) return publicBackgroundUrl(slugOk, serverMeta.updatedAt)
    return null
  }, [bgRemoved, bgBlobUrl, serverMeta.hasBackground, serverMeta.updatedAt, slugValid, slugOk])

  const publicUrl =
    slug.trim() && isValidSlug(slug.trim())
      ? `${window.location.origin}/${slug.trim().toLowerCase()}`
      : null

  const persistBackgroundFile = async (file: File | null) => {
    if (!file) {
      await saveBackgroundBlob(null)
      setBgBlobUrlSafe(null)
      setBgRemoved(true)
      setBgKind(null)
      return
    }
    const blob = file.slice(0, file.size, file.type)
    await saveBackgroundBlob(blob)
    const url = URL.createObjectURL(blob)
    setBgBlobUrlSafe(url)
    setBgRemoved(false)
    setBgKind(blob.type.startsWith('video/') ? 'video' : 'image')
  }

  const persistAvatarFile = async (file: File | null) => {
    if (!file) {
      await saveAvatarBlob(null)
      setAvatarBlobUrlSafe(null)
      setAvatarRemoved(true)
      return
    }
    const blob = file.slice(0, file.size, file.type)
    await saveAvatarBlob(blob)
    const url = URL.createObjectURL(blob)
    setAvatarBlobUrlSafe(url)
    setAvatarRemoved(false)
  }

  const onSave = useCallback(async () => {
    const s = slug.trim().toLowerCase()
    if (!isValidSlug(s)) {
      setSlugError(
        'Адрес страницы: латиница и цифры, дефис между словами, 2–30 символов. Нельзя: edit, api…',
      )
      return
    }
    setSlugError(null)
    setSyncErr(null)
    setSyncOk(null)

    const profile: Profile = {
      slug: s,
      displayName: displayName.trim(),
      bio: bio.trim(),
      links: links.filter((l) => l.title.trim() || l.url.trim()),
    }
    saveProfile(profile)

    setSaving(true)
    try {
      await savePublicProfile(s, {
        displayName: profile.displayName,
        bio: profile.bio,
        links: profile.links,
      })
      const avBlob = await loadAvatarBlob()
      if (avBlob) {
        await uploadAvatarToServer(s, avBlob)
      } else if (avatarRemoved) {
        await deleteAvatarOnServer(s).catch(() => {})
      }
      const bgBlob = await loadBackgroundBlob()
      if (bgBlob) {
        await uploadBackgroundToServer(s, bgBlob)
      } else if (bgRemoved) {
        await deleteBackgroundOnServer(s).catch(() => {})
      }
      const fresh = await fetchPublicProfile(s).catch(() => null)
      if (fresh) {
        setServerMeta({
          updatedAt: fresh.updatedAt,
          hasAvatar: fresh.hasAvatar,
          hasBackground: fresh.hasBackground,
          backgroundKind: fresh.backgroundKind,
        })
      }
      setAvatarRemoved(false)
      setBgRemoved(false)
      setSyncOk('Профиль на сервере — ссылка открывается у всех в браузере.')
      setSavedAt(
        new Date().toLocaleString('ru-RU', { timeStyle: 'short', dateStyle: 'short' }),
      )
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('telegram_auth_required') || msg.includes('401')) {
        msg =
          'Нужна авторизация Telegram: откройте редактор кнопкой «Открыть редактор» в боте (Mini App). Для локальных тестов без Telegram на сервере задайте ALLOW_INSECURE_EDIT=1.'
      }
      setSyncErr(msg)
      setSavedAt(
        new Date().toLocaleString('ru-RU', { timeStyle: 'short', dateStyle: 'short' }),
      )
    } finally {
      setSaving(false)
    }
  }, [slug, displayName, bio, links, avatarRemoved, bgRemoved])

  return (
    <div className="edit">
      <div className="edit__ambient" aria-hidden>
        <div className="edit__blob edit__blob--a" />
        <div className="edit__blob edit__blob--b" />
      </div>

      <header className="edit__bar">
        <Link to="/" className="edit__brand">
          Taplink
        </Link>
        <div className="edit__barRight">
          {publicUrl ? (
            <a className="edit__ghostBtn" href={publicUrl} target="_blank" rel="noreferrer">
              Просмотр
            </a>
          ) : null}
          <button type="button" className="edit__saveBtn" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </header>

      <main className="edit__main">
        <div className="edit__hero">
          <p className="edit__badge">Профиль</p>
          <h1 className="edit__title">Настройка страницы</h1>
          <p className="edit__lead">
            Локальный черновик в браузере + копия на сервере после «Сохранить». Так ваша ссылка
            работает у гостей и вне Telegram.
          </p>
          {!isTelegramWebApp() ? (
            <p className="edit__warn edit__warn--inline">
              Сохранение на сервер требует открыть эту страницу из Telegram (кнопка «Открыть редактор»
              в боте). Иначе сервер вернёт ошибку авторизации — для отладки можно задать{' '}
              <code className="edit__code">ALLOW_INSECURE_EDIT=1</code> на бэкенде.
            </p>
          ) : null}
        </div>

        {syncOk ? <p className="edit__ok">{syncOk}</p> : null}
        {syncErr ? <p className="edit__warn">Сервер: {syncErr}</p> : null}
        {savedAt ? <p className="edit__toast">Локально обновлено: {savedAt}</p> : null}
        {slugError ? <p className="edit__err">{slugError}</p> : null}

        <section className="edit__panel">
          <h2 className="edit__h2">Внешний вид</h2>
          <p className="edit__panelHint">
            Фон страницы — фото или короткое видео (MP4, WebM до ~14 МБ). На публичной странице фон
            на весь экран за карточкой. Удаление фона и аватара применяется на сервере только после
            «Сохранить».
          </p>
          <div className="edit__bgPreviewWrap">
            {bgPreview && bgKind === 'video' ? (
              <video
                className="edit__bgPreview"
                src={bgPreview}
                muted
                loop
                autoPlay
                playsInline
                controls
              />
            ) : bgPreview ? (
              <div className="edit__bgPreview edit__bgPreview--img" style={{ backgroundImage: `url(${bgPreview})` }} />
            ) : (
              <div className="edit__bgPreview edit__bgPreview--empty" aria-hidden>
                <span>Фон по умолчанию</span>
              </div>
            )}
          </div>
          <div className="edit__avatarRow edit__avatarRow--bg">
            <div className="edit__avatarBtns">
              <button type="button" className="edit__pill" onClick={() => bgFileRef.current?.click()}>
                Загрузить фон
              </button>
              {bgPreview ? (
                <button
                  type="button"
                  className="edit__pill edit__pill--danger"
                  onClick={() => void persistBackgroundFile(null)}
                >
                  Убрать фон
                </button>
              ) : null}
              <input
                ref={bgFileRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                className="edit__file"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void persistBackgroundFile(f)
                }}
              />
            </div>
          </div>
          <div className="edit__avatarRow">
            <div
              className="edit__avatar"
              style={
                avatarDisplay
                  ? { backgroundImage: `url(${avatarDisplay})` }
                  : { background: 'rgba(255,255,255,0.06)' }
              }
              role="img"
              aria-label="Аватар"
            />
            <div className="edit__avatarBtns">
              <button type="button" className="edit__pill" onClick={() => fileRef.current?.click()}>
                Загрузить фото
              </button>
              {avatarDisplay ? (
                <button
                  type="button"
                  className="edit__pill edit__pill--danger"
                  onClick={() => void persistAvatarFile(null)}
                >
                  Убрать фото
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="edit__file"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void persistAvatarFile(f)
                }}
              />
            </div>
          </div>
        </section>

        <section className="edit__panel">
          <h2 className="edit__h2">Адрес и текст</h2>
          <label className="edit__label" htmlFor={slugId}>
            Адрес страницы (латиницей)
          </label>
          <div className="edit__slugWrap">
            <span className="edit__slugPrefix">{window.location.origin}/</span>
            <input
              id={slugId}
              className="edit__input edit__input--slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-nickname"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <label className="edit__label">Имя на странице</label>
          <input
            className="edit__input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Как вас представить"
          />

          <label className="edit__label">О себе</label>
          <textarea
            className="edit__textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            placeholder="Короткое описание, эмодзи приветствуются"
          />
        </section>

        <section className="edit__panel">
          <div className="edit__linksHead">
            <h2 className="edit__h2 edit__h2--inline">Ссылки</h2>
            <button
              type="button"
              className="edit__pill"
              onClick={() => setLinks((prev) => [...prev, newLink()])}
            >
              + Добавить
            </button>
          </div>

          <ul className="edit__linkList">
            {links.map((row) => (
              <li key={row.id} className="edit__linkRow">
                <input
                  className="edit__input"
                  placeholder="Подпись кнопки"
                  value={row.title}
                  onChange={(e) => {
                    const v = e.target.value
                    setLinks((prev) => prev.map((x) => (x.id === row.id ? { ...x, title: v } : x)))
                  }}
                />
                <input
                  className="edit__input"
                  placeholder="https://…"
                  value={row.url}
                  onChange={(e) => {
                    const v = e.target.value
                    setLinks((prev) => prev.map((x) => (x.id === row.id ? { ...x, url: v } : x)))
                  }}
                />
                <button
                  type="button"
                  className="edit__iconBtn"
                  aria-label="Удалить ссылку"
                  onClick={() =>
                    setLinks((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== row.id)))
                  }
                  disabled={links.length <= 1}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {publicUrl ? (
            <p className="edit__public">
              Публичная ссылка:{' '}
              <a href={publicUrl} className="edit__publicLink">
                {publicUrl}
              </a>
            </p>
          ) : (
            <p className="edit__hint">Укажите корректный адрес (slug), чтобы появилась ссылка.</p>
          )}
        </section>
      </main>
    </div>
  )
}
