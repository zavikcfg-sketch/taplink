import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Profile } from '../types/profile'
import { normalizeThemeId } from '../lib/themes'
import { linkDomainHint } from '../lib/linkIcons'
import { normalizeHttpUrl } from '../lib/url'
import { publicAvatarUrl, publicBackgroundUrl } from '../lib/api'
import './ProfileCard.css'

function ProfileAvatarLocal({ url }: { url: string }) {
  return <div className="pcard__avatar" style={{ backgroundImage: `url(${url})` }} />
}

function RemoteAvatar({ slug, cacheBust }: { slug: string; cacheBust?: string }) {
  const src = publicAvatarUrl(slug, cacheBust)
  const [ok, setOk] = useState(true)
  if (!ok) {
    return <div className="pcard__avatar pcard__avatar--ph" aria-hidden />
  }
  return (
    <div className="pcard__avatarFrame">
      <img src={src} alt="" className="pcard__avatarImg" onError={() => setOk(false)} />
    </div>
  )
}

function CardBackground({
  slug,
  kind,
  cacheBust,
}: {
  slug: string
  kind: 'image' | 'video'
  cacheBust?: string
}) {
  const src = publicBackgroundUrl(slug, cacheBust)
  const [failed, setFailed] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mq.matches)
    const fn = () => setReduceMotion(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  if (failed || (reduceMotion && kind === 'video')) {
    return (
      <div className="pcard__bg pcard__bg--fallback" aria-hidden>
        <div className="pcard__bgScrim" />
      </div>
    )
  }

  return (
    <div className="pcard__bg" aria-hidden>
      {kind === 'video' ? (
        <video
          className="pcard__bgMedia"
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <img className="pcard__bgMedia" src={src} alt="" decoding="async" onError={() => setFailed(true)} />
      )}
      <div className="pcard__bgScrim" />
    </div>
  )
}

export type ProfileCardProps = {
  profile: Profile
  localAvatarUrl?: string | null
  localBgUrl?: string | null
  localBgKind?: 'image' | 'video' | null
  phase?: 'loading' | 'ready'
  showGlowFallback?: boolean
  onLinkNavigate?: (linkId: string, href: string) => void
  showFooter?: boolean
  footerExtra?: ReactNode
}

export default function ProfileCard({
  profile,
  localAvatarUrl,
  localBgUrl,
  localBgKind,
  phase = 'ready',
  showGlowFallback,
  onLinkNavigate,
  showFooter = true,
  footerExtra,
}: ProfileCardProps) {
  const theme = normalizeThemeId(profile.themeId)
  const validLinks = profile.links.flatMap((l) => {
    const href = normalizeHttpUrl(l.url)
    if (!href) return []
    return [{ ...l, href }]
  })

  const bgKind: 'image' | 'video' | null =
    profile.hasBackground && profile.backgroundKind === 'video'
      ? 'video'
      : profile.hasBackground
        ? 'image'
        : null

  const useLocalBg = Boolean(localBgUrl && localBgKind)
  const useLocalAvatar = Boolean(localAvatarUrl)

  return (
    <div
      className={`pcard pcard--theme-${theme}${bgKind || useLocalBg ? ' pcard--hasBg' : ''}`}
      data-phase={phase}
    >
      {useLocalBg && localBgUrl && localBgKind ? (
        <div className="pcard__bg" aria-hidden>
          {localBgKind === 'video' ? (
            <video
              className="pcard__bgMedia"
              src={localBgUrl}
              muted
              loop
              autoPlay
              playsInline
            />
          ) : (
            <img className="pcard__bgMedia" src={localBgUrl} alt="" />
          )}
          <div className="pcard__bgScrim" />
        </div>
      ) : bgKind ? (
        <CardBackground slug={profile.slug} kind={bgKind} cacheBust={profile.updatedAt} />
      ) : showGlowFallback ? (
        <div className="pcard__glow" aria-hidden />
      ) : null}

      <div className="pcard__card">
        {profile.hasAvatar && !useLocalAvatar ? (
          <RemoteAvatar slug={profile.slug} cacheBust={profile.updatedAt} />
        ) : useLocalAvatar ? (
          <ProfileAvatarLocal url={localAvatarUrl!} />
        ) : (
          <div className="pcard__avatar pcard__avatar--ph" aria-hidden />
        )}

        <h1 className="pcard__name">{profile.displayName || profile.slug}</h1>
        {profile.bio ? <p className="pcard__bio">{profile.bio}</p> : null}

        <ul className="pcard__links">
          {validLinks.map((l) => {
            const clicks = profile.linkClicks?.[l.id] ?? 0
            const hint = linkDomainHint(l.href)
            return (
              <li key={l.id}>
                <a
                  className="pcard__link"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onLinkNavigate?.(l.id, l.href)}
                >
                  <span className="pcard__linkMain">
                    {hint ? <span className="pcard__hint">{hint}</span> : null}
                    <span className="pcard__linkLabel">
                      {l.title.trim() || new URL(l.href).hostname}
                    </span>
                  </span>
                  {clicks > 0 ? (
                    <span className="pcard__stat" aria-label={`Переходов: ${clicks}`}>
                      {clicks}
                    </span>
                  ) : null}
                </a>
              </li>
            )
          })}
        </ul>

        {showFooter ? (
          <footer className="pcard__foot">
            <div className="pcard__footRow">
              <Link to="/" className="pcard__mini">
                Taplink
              </Link>
              <span className="pcard__dot">·</span>
              <Link to="/edit" className="pcard__mini">
                Изменить
              </Link>
            </div>
            {footerExtra ? <div className="pcard__footExtra">{footerExtra}</div> : null}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
