import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import QRCode from 'react-qr-code'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import InternalLayout from '../components/InternalLayout'
import ProfileCard from '../components/ProfileCard'
import type { Profile, ProfileLink, ThemeId } from '../types/profile'
import {
  deleteAccountOnServer,
  deleteAvatarOnServer,
  deleteBackgroundOnServer,
  exportProfileJson,
  fetchEditorProfile,
  fetchPublicProfile,
  publicAvatarUrl,
  publicBackgroundUrl,
  savePublicProfile,
  uploadAvatarToServer,
  uploadBackgroundToServer,
} from '../lib/api'
import { filterLinksForPublic } from '../lib/linkFilters'
import {
  clearAllLocalProfile,
  isValidSlug,
  loadAvatarBlob,
  loadBackgroundBlob,
  loadProfile,
  saveAvatarBlob,
  saveBackgroundBlob,
  saveProfile,
} from '../lib/profileStorage'
import { THEME_IDS, THEME_LABELS, normalizeThemeId } from '../lib/themes'
import { isTelegramWebApp } from '../lib/telegramInit'
import './EditPage.css'

function safeId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  if (c?.getRandomValues) {
    const a = new Uint32Array(4)
    c.getRandomValues(a)
    return `l-${a[0].toString(16)}${a[1].toString(16)}${a[2].toString(16)}${a[3].toString(16)}`
  }
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function newLink(): ProfileLink {
  return { id: safeId(), title: '', url: '', hidden: false }
}

function isoToDatetimeLocalValue(raw: string | undefined): string {
  if (!raw?.trim()) return ''
  const d = new Date(raw.trim())
  if (!Number.isFinite(d.getTime())) return raw.trim().slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToStored(raw: string): string | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const d = new Date(t)
  return Number.isFinite(d.getTime()) ? d.toISOString() : t
}

function reorderLinks(list: ProfileLink[], fromId: string, toId: string): ProfileLink[] {
  const i = list.findIndex((x) => x.id === fromId)
  const j = list.findIndex((x) => x.id === toId)
  if (i < 0 || j < 0 || i === j) return list
  const next = [...list]
  const [item] = next.splice(i, 1)
  next.splice(j, 0, item)
  return next
}

function applyProfile(
  p: Profile,
  setSlug: (v: string) => void,
  setDisplayName: (v: string) => void,
  setBio: (v: string) => void,
  setLinks: (v: ProfileLink[]) => void,
  setThemeId: (v: ThemeId) => void,
  setBackgroundMuted: (v: boolean) => void,
  setPlan: (v: 'free' | 'vip') => void,
) {
  setSlug(p.slug)
  setDisplayName(p.displayName)
  setBio(p.bio)
  setLinks(p.links.length ? p.links : [newLink()])
  setThemeId(normalizeThemeId(p.themeId))
  setBackgroundMuted(p.backgroundMuted !== false)
  setPlan(p.plan === 'vip' ? 'vip' : 'free')
}

type ServerMeta = {
  updatedAt?: string
  hasAvatar?: boolean
  hasBackground?: boolean
  backgroundKind?: 'image' | 'video'
}

const claimStorageKey = (slug: string) => `taplink_claim_${slug}`

export default function EditPage() {
  const slugId = useId()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [themeId, setThemeId] = useState<ThemeId>('purple')
  const [backgroundMuted, setBackgroundMuted] = useState(true)
  const [plan, setPlan] = useState<'free' | 'vip'>('free')
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
  const [claimSlug, setClaimSlug] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bgFileRef = useRef<HTMLInputElement>(null)
  const dragLinkId = useRef<string | null>(null)

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
      let remote: Profile | null = null
      if (local?.slug && isValidSlug(local.slug)) {
        remote = await fetchEditorProfile(local.slug).catch(() => null)
        if (cancelled) return
        if (!remote) {
          remote = await fetchPublicProfile(local.slug).catch(() => null)
        }
        if (remote) {
          applyProfile(
            remote,
            setSlug,
            setDisplayName,
            setBio,
            setLinks,
            setThemeId,
            setBackgroundMuted,
            setPlan,
          )
          setServerMeta({
            updatedAt: remote.updatedAt,
            hasAvatar: remote.hasAvatar,
            hasBackground: remote.hasBackground,
            backgroundKind: remote.backgroundKind,
          })
        } else {
          applyProfile(
            local,
            setSlug,
            setDisplayName,
            setBio,
            setLinks,
            setThemeId,
            setBackgroundMuted,
            setPlan,
          )
        }
      } else if (local) {
        applyProfile(
          local,
          setSlug,
          setDisplayName,
          setBio,
          setLinks,
          setThemeId,
          setBackgroundMuted,
          setPlan,
        )
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
    if (!isTelegramWebApp()) return
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

  useEffect(() => {
    const qpTheme = normalizeThemeId(searchParams.get('theme') || undefined)
    if (qpTheme) setThemeId(qpTheme)
    const qpPlan = (searchParams.get('plan') || '').toLowerCase()
    if (qpPlan === 'vip' || qpPlan === 'free') {
      setPlan(qpPlan)
    }
  }, [searchParams])

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

  const shortRefUrl =
    slug.trim() && isValidSlug(slug.trim())
      ? `${window.location.origin}/r/${slug.trim().toLowerCase()}`
      : null

  const shareTelegramUrl = publicUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(
        displayName.trim() || slugOk,
      )}`
    : null
  const linksLimit = plan === 'vip' ? 30 : 8
  const canAddMoreLinks = links.length < linksLimit

  useEffect(() => {
    const s = slug.trim().toLowerCase()
    if (!isValidSlug(s)) return
    const t = window.setTimeout(() => {
      saveProfile({
        slug: s,
        displayName: displayName.trim(),
        bio: bio.trim(),
        links,
        themeId,
        backgroundMuted,
        plan,
      })
    }, 180)
    return () => window.clearTimeout(t)
  }, [slug, displayName, bio, links, themeId, backgroundMuted, plan])

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

  const runSave = useCallback(
    async (opts?: { skipClaim?: boolean }) => {
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

      if (!opts?.skipClaim) {
        const existsOnServer = await fetchPublicProfile(s).catch(() => null)
        if (!existsOnServer && !sessionStorage.getItem(claimStorageKey(s))) {
          setClaimSlug(s)
          return
        }
      }

      const profile: Profile = {
        slug: s,
        displayName: displayName.trim(),
        bio: bio.trim(),
        links: links.filter((l) => l.title.trim() || l.url.trim()),
        themeId,
        backgroundMuted,
        plan,
      }
      saveProfile(profile)

      setSaving(true)
      try {
        await savePublicProfile(s, {
          displayName: profile.displayName,
          bio: profile.bio,
          links: profile.links,
          themeId,
          backgroundMuted,
          plan,
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
        if (msg.includes('free_plan_links_limit')) {
          msg = 'Лимит Free-тарифа: максимум 8 ссылок. Переключитесь на VIP.'
        }
        if (msg.includes('vip_background_sound_required')) {
          msg = 'Фоновое видео со звуком доступно только в VIP-тарифе.'
        }
        setSyncErr(msg)
        setSavedAt(
          new Date().toLocaleString('ru-RU', { timeStyle: 'short', dateStyle: 'short' }),
        )
      } finally {
        setSaving(false)
      }
    },
    [slug, displayName, bio, links, themeId, backgroundMuted, plan, avatarRemoved, bgRemoved],
  )

  const previewProfile: Profile = useMemo(() => {
    const nonempty = links.filter((l) => l.title.trim() || l.url.trim())
    const filtered = filterLinksForPublic(nonempty)
    const showAvatar =
      !avatarRemoved &&
      (Boolean(avatarBlobUrl) || Boolean(slugValid && serverMeta.hasAvatar))
    const showBg =
      !bgRemoved &&
      (Boolean(bgBlobUrl) || Boolean(slugValid && serverMeta.hasBackground))
    let backgroundKind: 'image' | 'video' | undefined
    if (bgBlobUrl && bgKind) backgroundKind = bgKind
    else if (slugValid && serverMeta.hasBackground && !bgRemoved)
      backgroundKind = serverMeta.backgroundKind === 'video' ? 'video' : 'image'

    return {
      slug: slugValid ? slugOk : 'preview',
      displayName: displayName.trim(),
      bio: bio.trim(),
      links: filtered,
      themeId,
      backgroundMuted,
      plan,
      updatedAt: slugValid ? serverMeta.updatedAt : undefined,
      hasAvatar: showAvatar,
      hasBackground: showBg,
      backgroundKind,
    }
  }, [
    links,
    avatarRemoved,
    avatarBlobUrl,
    slugValid,
    slugOk,
    serverMeta.hasAvatar,
    serverMeta.hasBackground,
    serverMeta.backgroundKind,
    serverMeta.updatedAt,
    bgRemoved,
    bgBlobUrl,
    bgKind,
    displayName,
    bio,
    themeId,
    backgroundMuted,
    plan,
  ])

  const confirmClaimAndSave = () => {
    if (!claimSlug) return
    sessionStorage.setItem(claimStorageKey(claimSlug), '1')
    setClaimSlug(null)
    void runSave({ skipClaim: true })
  }

  return (
    <InternalLayout>
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
          <button type="button" className="edit__saveBtn" onClick={() => void runSave()} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </header>

      <main className="edit__main edit__main--wide">
        <div className="edit__hero">
          <p className="edit__badge">Профиль</p>
          <h1 className="edit__title">Настройка страницы</h1>
          <p className="edit__lead">
            Локальный черновик в браузере + копия на сервере после «Сохранить». Так ваша ссылка
            работает у гостей и вне Telegram.
          </p>
          {!isTelegramWebApp() ? (
            <p className="edit__warn edit__warn--inline">
              Редактор работает как обычный веб-сайт. Если на сервере отключён веб-режим, включите{' '}
              <code className="edit__code">ALLOW_INSECURE_EDIT=1</code> в окружении.
            </p>
          ) : null}
        </div>

        {syncOk ? <p className="edit__ok">{syncOk}</p> : null}
        {syncErr ? <p className="edit__warn">Сервер: {syncErr}</p> : null}
        {savedAt ? <p className="edit__toast">Локально обновлено: {savedAt}</p> : null}
        {slugError ? <p className="edit__err">{slugError}</p> : null}

        <section className="edit__panel">
          <h2 className="edit__h2">Предпросмотр</h2>
          <p className="edit__panelHint">
            То, что видят гости: скрытые ссылки и вне расписания не показываются.
          </p>
          <div className="edit__previewShell">
            <ProfileCard
              profile={previewProfile}
              localAvatarUrl={avatarBlobUrl}
              localBgUrl={bgBlobUrl}
              localBgKind={bgKind}
              showGlowFallback={!previewProfile.hasBackground}
            />
          </div>
        </section>

        <section className="edit__panel">
          <h2 className="edit__h2">Тема карточки</h2>
          <div className="edit__themeGrid">
            {THEME_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`edit__themeChip${themeId === id ? ' edit__themeChip--active' : ''}`}
                onClick={() => setThemeId(id)}
              >
                {THEME_LABELS[id]}
              </button>
            ))}
          </div>
        </section>

        <section className="edit__panel">
          <h2 className="edit__h2">Тариф</h2>
          <div className="edit__themeGrid">
            <button
              type="button"
              className={`edit__themeChip${plan === 'free' ? ' edit__themeChip--active' : ''}`}
              onClick={() => {
                setPlan('free')
                setBackgroundMuted(true)
              }}
            >
              Free
            </button>
            <button
              type="button"
              className={`edit__themeChip${plan === 'vip' ? ' edit__themeChip--active' : ''}`}
              onClick={() => setPlan('vip')}
            >
              VIP
            </button>
          </div>
          <ul className="edit__vipList">
            <li>Free: до 8 ссылок, видеофон только без звука.</li>
            <li>VIP: до 30 ссылок, видеофон со звуком, приоритет в каталоге.</li>
            <li>VIP: бейдж на странице и будущая расширенная аналитика.</li>
          </ul>
        </section>

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
                muted={backgroundMuted}
                loop
                autoPlay
                playsInline
                preload="auto"
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
          {bgKind === 'video' ? (
            <label className="edit__toggle">
              <input
                type="checkbox"
                checked={backgroundMuted}
                onChange={(e) => {
                  if (plan === 'free' && !e.target.checked) {
                    setSyncErr('Фоновое видео со звуком доступно только в VIP.')
                    return
                  }
                  setBackgroundMuted(e.target.checked)
                }}
              />
              <span>Фоновое видео без звука (рекомендуется для автозапуска на телефонах)</span>
            </label>
          ) : null}
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
              disabled={!canAddMoreLinks}
              onClick={() => setLinks((prev) => [...prev, newLink()])}
            >
              + Добавить
            </button>
          </div>
          <p className="edit__panelHint">
            Лимит текущего тарифа: {linksLimit} ссылок.
          </p>
          <p className="edit__panelHint">
            Перетаскивайте за ⋮⋮. «Скрыть» убирает кнопку с публичной страницы без удаления.
          </p>

          <ul className="edit__linkList">
            {links.map((row) => (
              <li
                key={row.id}
                className="edit__linkBlock"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = e.dataTransfer.getData('text/plain') || dragLinkId.current
                  dragLinkId.current = null
                  if (!from || from === row.id) return
                  setLinks((prev) => reorderLinks(prev, from, row.id))
                }}
              >
                <div className="edit__linkRowTop">
                  <span
                    className="edit__drag"
                    draggable
                    role="button"
                    tabIndex={0}
                    aria-label="Перетащить"
                    onDragStart={(e) => {
                      dragLinkId.current = row.id
                      e.dataTransfer.setData('text/plain', row.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      dragLinkId.current = null
                    }}
                  >
                    ⋮⋮
                  </span>
                  <input
                    className="edit__input edit__input--inRow"
                    placeholder="Подпись кнопки"
                    value={row.title}
                    onChange={(e) => {
                      const v = e.target.value
                      setLinks((prev) => prev.map((x) => (x.id === row.id ? { ...x, title: v } : x)))
                    }}
                  />
                  <input
                    className="edit__input edit__input--inRow"
                    placeholder="https://…"
                    value={row.url}
                    onChange={(e) => {
                      const v = e.target.value
                      setLinks((prev) => prev.map((x) => (x.id === row.id ? { ...x, url: v } : x)))
                    }}
                  />
                  <label className="edit__hideLbl">
                    <input
                      type="checkbox"
                      checked={Boolean(row.hidden)}
                      onChange={(e) =>
                        setLinks((prev) =>
                          prev.map((x) => (x.id === row.id ? { ...x, hidden: e.target.checked } : x)),
                        )
                      }
                    />
                    скрыть
                  </label>
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
                </div>
                <div className="edit__linkSchedule">
                  <label className="edit__scheduleLbl">
                    Показывать с
                    <input
                      type="datetime-local"
                      className="edit__scheduleInput"
                      value={isoToDatetimeLocalValue(row.visibleFrom)}
                      onChange={(e) =>
                        setLinks((prev) =>
                          prev.map((x) =>
                            x.id === row.id ? { ...x, visibleFrom: datetimeLocalToStored(e.target.value) } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="edit__scheduleLbl">
                    до
                    <input
                      type="datetime-local"
                      className="edit__scheduleInput"
                      value={isoToDatetimeLocalValue(row.visibleUntil)}
                      onChange={(e) =>
                        setLinks((prev) =>
                          prev.map((x) =>
                            x.id === row.id
                              ? { ...x, visibleUntil: datetimeLocalToStored(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>

          {publicUrl ? (
            <div className="edit__shareBlock">
              <p className="edit__public">
                Публичная ссылка:{' '}
                <a href={publicUrl} className="edit__publicLink">
                  {publicUrl}
                </a>
              </p>
              {shortRefUrl ? (
                <p className="edit__public edit__public--muted">
                  Короткая ссылка:{' '}
                  <a href={shortRefUrl} className="edit__publicLink">
                    {shortRefUrl}
                  </a>
                </p>
              ) : null}
              <div className="edit__qrRow">
                <div className="edit__qrBox">
                  <QRCode value={publicUrl} size={128} fgColor="#111827" bgColor="#ffffff" />
                </div>
                <div className="edit__qrHint">
                  <p className="edit__qrTitle">QR на вашу страницу</p>
                  {shareTelegramUrl ? (
                    <a className="edit__pill edit__pill--accent" href={shareTelegramUrl} target="_blank" rel="noreferrer">
                      Открыть шаринг в Telegram
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="edit__hint">Укажите корректный адрес (slug), чтобы появилась ссылка и QR.</p>
          )}
        </section>

        <section className="edit__panel edit__panel--danger">
          <h2 className="edit__h2">Данные</h2>
          <p className="edit__panelHint">
            Экспорт JSON и удаление аккаунта доступны после сохранения профиля на сервер с тем же
            slug (авторизация Telegram или ALLOW_INSECURE_EDIT).
          </p>
          <div className="edit__dangerRow">
            <button
              type="button"
              className="edit__pill"
              disabled={!slugValid}
              onClick={() => {
                if (!slugValid) return
                void exportProfileJson(slugOk).catch((e) =>
                  setSyncErr(e instanceof Error ? e.message : String(e)),
                )
              }}
            >
              Экспорт JSON
            </button>
            <button
              type="button"
              className="edit__pill edit__pill--danger"
              disabled={!slugValid || saving}
              onClick={() => {
                if (!slugValid) return
                if (
                  !window.confirm(
                    'Удалить аккаунт и все данные профиля на сервере без восстановления?',
                  )
                )
                  return
                void (async () => {
                  try {
                    await deleteAccountOnServer(slugOk)
                    await clearAllLocalProfile()
                    navigate('/')
                  } catch (e) {
                    setSyncErr(e instanceof Error ? e.message : String(e))
                  }
                })()
              }}
            >
              Удалить аккаунт
            </button>
          </div>
        </section>
      </main>

      {claimSlug ? (
        <div className="edit__modalOverlay" role="presentation" onClick={() => setClaimSlug(null)}>
          <div
            className="edit__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="claim-title" className="edit__modalTitle">
              Закрепить адрес страницы?
            </h2>
            <p className="edit__modalText">
              Адрес{' '}
              <strong>
                {window.location.origin}/{claimSlug}
              </strong>{' '}
              пока свободен. После сохранения страница будет опубликована и привязана к вашему
              аккаунту в Telegram (или к режиму редактирования без Telegram при ALLOW_INSECURE_EDIT).
            </p>
            <div className="edit__modalActions">
              <button type="button" className="edit__pill" onClick={() => setClaimSlug(null)}>
                Отмена
              </button>
              <button type="button" className="edit__saveBtn edit__saveBtn--modal" onClick={confirmClaimAndSave}>
                Опубликовать
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </InternalLayout>
  )
}
