import type { ReactNode } from 'react'
import SiteNav from './SiteNav'
import './InternalLayout.css'

export default function InternalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ilayout">
      <SiteNav />
      <div className="ilayout__ambient" aria-hidden>
        <div className="ilayout__blob ilayout__blob--a" />
        <div className="ilayout__blob ilayout__blob--b" />
      </div>
      <div className="ilayout__content">{children}</div>
    </div>
  )
}
