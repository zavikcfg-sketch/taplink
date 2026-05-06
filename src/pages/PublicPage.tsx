import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ProfileCard from '../components/ProfileCard'
import {
  fetchPublicProfile,
  publicBackgroundUrl,
  publicOgImageUrl,
  recordLinkClick,
  reportPublicPage,
} from '../lib/api'
import { loadAvatarBlob, loadProfile } from '../lib/profileStorage'
import type { Profile } from '../types/profile'
import './PublicPage.css'

function setOrCreateMeta(attr: 'name' | 'property', key: string, content: string) {
  const sel = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`
  let el = document.querySelector(sel) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function useLocalAvatarBlobUrl(enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setUrl(null)
      return
    }
    let cancelled = false
    let created: string | null = null
    void loadAvatarBlob().then((b) => {
      if (cancelled || !b) return
      created = URL.createObjectURL(b)
      setUrl(created)
    })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [enabled])

  return url
}

function PublicPageInner({ slug }: { slug: string }) {
  const want = slug.toLowerCase()
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fromLocal, setFromLocal] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportText, setReportText] = useState('')
  const [reportOk, setReportOk] = useState<string | null>(null)
  const [reportErr, setReportErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await fetchPublicProfile(want).catch(() => null)
      if (cancelled) return
      if (remote) {
        setProfile(remote)
        setFromLocal(false)
        setPhase('ready')
        return
      }
      const local = loadProfile()
      if (local && local.slug === want) {
        setProfile(local)
        setFromLocal(true)
        setPhase('ready')
        return
      }
      setProfile(null)
      setFromLocal(false)
      setPhase('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [want])

  const localAvatarUrl = useLocalAvatarBlobUrl(Boolean(fromLocal && profile && !profile.hasAvatar))

  useEffect(() => {
    if (!profile) {
      document.title = 'Taplink'
      return
    }
    const titleBase = profile.displayName || profile.slug
    document.title = `${titleBase} — Taplink`
    const desc = (
      profile.bio.trim() ||
      `Страница ${titleBase} — ссылки и контакты на Taplink.`
    ).slice(0, 200)
    const ogImg = publicOgImageUrl(profile.slug)
    setOrCreateMeta('name', 'description', desc)
    setOrCreateMeta('property', 'og:title', `${titleBase} — Taplink`)
    setOrCreateMeta('property', 'og:description', desc)
    setOrCreateMeta('property', 'og:image', ogImg)
    setOrCreateMeta('property', 'og:image:type', 'image/png')
    setOrCreateMeta('name', 'twitter:card', 'summary_large_image')
    setOrCreateMeta('name', 'twitter:title', `${titleBase} — Taplink`)
    setOrCreateMeta('name', 'twitter:description', desc)
    setOrCreateMeta('name', 'twitter:image', ogImg)
  }, [profile])

  useEffect(() => {
    if (!profile?.hasBackground || profile.backgroundKind !== 'video') return
    const href = publicBackgroundUrl(profile.slug, profile.updatedAt)
    const el = document.createElement('link')
    el.rel = 'preload'
    el.as = 'video'
    el.href = href
    document.head.appendChild(el)
    return () => {
      el.remove()
    }
  }, [profile])

  const submitReport = async () => {
    if (!profile) return
    setReportErr(null)
    setReportOk(null)
    try {
      await reportPublicPage(profile.slug, reportText)
      setReportOk('Спасибо, жалоба отправлена.')
      setReportText('')
      setReportOpen(false)
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (phase === 'loading') {
    return (
      <div className="pub pub--loading">
        <div className="pub__glow" aria-hidden />
        <div className="pub__skeleton" aria-busy="true">
          <div className="pub__skCircle" />
          <div className="pub__skLine pub__skLine--lg" />
          <div className="pub__skLine" />
          <div className="pub__skBtn" />
          <div className="pub__skBtn" />
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="pub">
        <div className="pub__glow" aria-hidden />
        <div className="pub__empty">
          <h1 className="pub__emptyTitle">Страница не найдена</h1>
          <p className="pub__emptyText">
            По адресу <code>/{slug}</code> ещё никто не опубликовал профиль. Если это ваш адрес —
            откройте редактор из Telegram-бота, настройте страницу и нажмите «Сохранить».
          </p>
          <Link className="pub__btn" to="/">
            На главную
          </Link>
          <Link className="pub__btn pub__btn--ghost" to="/edit">
            Редактор
          </Link>
        </div>
      </div>
    )
  }

  const bgKind =
    profile.hasBackground && profile.backgroundKind === 'video'
      ? ('video' as const)
      : profile.hasBackground
        ? ('image' as const)
        : null

  return (
    <div className={`pub${bgKind ? ' pub--hasBg' : ''}`}>
      {reportErr ? <p className="pub__banner pub__banner--warn">{reportErr}</p> : null}
      {reportOk ? <p className="pub__banner pub__banner--ok">{reportOk}</p> : null}

      <ProfileCard
        profile={profile}
        localAvatarUrl={localAvatarUrl}
        showGlowFallback={!bgKind}
        onLinkNavigate={(linkId) => recordLinkClick(profile.slug, linkId)}
        footerExtra={
          !fromLocal ? (
            <button type="button" className="pcard__reportBtn" onClick={() => setReportOpen(true)}>
              Пожаловаться
            </button>
          ) : null
        }
      />

      {reportOpen ? (
        <div className="pub__modalOverlay" role="presentation" onClick={() => setReportOpen(false)}>
          <div
            className="pub__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="report-title" className="pub__modalTitle">
              Жалоба на страницу
            </h2>
            <p className="pub__modalHint">Опишите проблему (спам, фишинг и т.д.).</p>
            <textarea
              className="pub__modalInput"
              rows={4}
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              placeholder="Текст жалобы…"
            />
            <div className="pub__modalActions">
              <button type="button" className="pub__btn pub__btn--ghost" onClick={() => setReportOpen(false)}>
                Отмена
              </button>
              <button type="button" className="pub__btn" onClick={() => void submitReport()}>
                Отправить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function PublicPage() {
  const { slug } = useParams()
  if (!slug) {
    return null
  }
  return <PublicPageInner key={slug} slug={slug} />
}
