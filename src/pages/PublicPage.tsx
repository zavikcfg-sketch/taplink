import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchPublicProfile, publicAvatarUrl, publicBackgroundUrl, recordLinkClick } from '../lib/api'
import { loadAvatarBlob, loadProfile } from '../lib/profileStorage'
import { normalizeHttpUrl } from '../lib/url'
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

function ProfileAvatarLocal() {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const created = { current: null as string | null }
    void loadAvatarBlob().then((b) => {
      if (cancelled || !b) return
      const u = URL.createObjectURL(b)
      created.current = u
      setUrl(u)
    })
    return () => {
      cancelled = true
      if (created.current) URL.revokeObjectURL(created.current)
    }
  }, [])

  if (url) {
    return <div className="pub__avatar" style={{ backgroundImage: `url(${url})` }} />
  }
  return <div className="pub__avatar pub__avatar--placeholder" aria-hidden />
}

function PublicBackground({
  slug,
  kind,
  cacheBust,
}: {
  slug: string
  kind: 'image' | 'video'
  cacheBust?: string
}) {
  const src = publicBackgroundUrl(slug, cacheBust)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduceMotion(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  if (mediaFailed || (reduceMotion && kind === 'video')) {
    return (
      <div className="pub__bg pub__bg--fallback" aria-hidden>
        <div className="pub__bgScrim" />
      </div>
    )
  }

  return (
    <div className="pub__bg" aria-hidden>
      {kind === 'video' ? (
        <video
          className="pub__bgMedia"
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setMediaFailed(true)}
        />
      ) : (
        <img
          className="pub__bgMedia"
          src={src}
          alt=""
          decoding="async"
          onError={() => setMediaFailed(true)}
        />
      )}
      <div className="pub__bgScrim" />
    </div>
  )
}

function RemoteAvatar({
  slug,
  cacheBust,
}: {
  slug: string
  cacheBust?: string
}) {
  const src = publicAvatarUrl(slug, cacheBust)
  const [ok, setOk] = useState(true)
  if (!ok) {
    return <div className="pub__avatar pub__avatar--placeholder" aria-hidden />
  }
  return (
    <div className="pub__avatarFrame">
      <img
        src={src}
        alt=""
        className="pub__avatarImg"
        onError={() => setOk(false)}
      />
    </div>
  )
}

function PublicPageInner({ slug }: { slug: string }) {
  const want = slug.toLowerCase()
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fromLocal, setFromLocal] = useState(false)

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
    setOrCreateMeta('name', 'description', desc)
    setOrCreateMeta('property', 'og:title', `${titleBase} — Taplink`)
    setOrCreateMeta('property', 'og:description', desc)
  }, [profile])

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

  const validLinks = profile.links.flatMap((l) => {
    const href = normalizeHttpUrl(l.url)
    if (!href) return []
    return [{ ...l, href }]
  })

  const showRemoteAvatar = Boolean(profile.hasAvatar)
  const showLocalAvatar = fromLocal && !showRemoteAvatar
  const bgKind: 'image' | 'video' | null =
    profile.hasBackground && profile.backgroundKind === 'video'
      ? 'video'
      : profile.hasBackground
        ? 'image'
        : null

  return (
    <div className={`pub${bgKind ? ' pub--hasBg' : ''}`}>
      {bgKind ? (
        <PublicBackground slug={profile.slug} kind={bgKind} cacheBust={profile.updatedAt} />
      ) : (
        <div className="pub__glow" aria-hidden />
      )}
      <div className="pub__card">
        {showRemoteAvatar ? (
          <RemoteAvatar slug={profile.slug} cacheBust={profile.updatedAt} />
        ) : showLocalAvatar ? (
          <ProfileAvatarLocal key={profile.slug} />
        ) : (
          <div className="pub__avatar pub__avatar--placeholder" aria-hidden />
        )}
        <h1 className="pub__name">{profile.displayName || profile.slug}</h1>
        {profile.bio ? <p className="pub__bio">{profile.bio}</p> : null}

        <ul className="pub__links">
          {validLinks.map((l) => {
            const clicks = profile.linkClicks?.[l.id] ?? 0
            return (
              <li key={l.id}>
                <a
                  className="pub__link"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => recordLinkClick(profile.slug, l.id)}
                >
                  <span className="pub__linkLabel">
                    {l.title.trim() || new URL(l.href).hostname}
                  </span>
                  {clicks > 0 ? (
                    <span className="pub__linkStat" aria-label={`Переходов: ${clicks}`}>
                      {clicks}
                    </span>
                  ) : null}
                </a>
              </li>
            )
          })}
        </ul>

        <footer className="pub__foot">
          <Link to="/" className="pub__mini">
            Taplink
          </Link>
          <span className="pub__dot">·</span>
          <Link to="/edit" className="pub__mini">
            Изменить
          </Link>
        </footer>
      </div>
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
