import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCatalog, type CatalogEntry } from '../lib/api'
import './CatalogPage.css'

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchCatalog()
        if (!cancelled) {
          setItems(rows)
          setErr(rows.length === 0 ? 'Пока никто не опубликовал страницу.' : null)
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e))
          setItems([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="cat">
      <div className="cat__ambient" aria-hidden>
        <div className="cat__blob cat__blob--a" />
        <div className="cat__blob cat__blob--b" />
      </div>
      <header className="cat__bar">
        <Link to="/" className="cat__brand">
          Taplink
        </Link>
        <Link to="/1" className="cat__ghost">
          Редактор
        </Link>
      </header>
      <main className="cat__main">
        <h1 className="cat__title">Каталог страниц</h1>
        <p className="cat__lead">
          Список опубликованных профилей (если на сервере включён{' '}
          <code className="cat__code">PUBLIC_CATALOG=1</code>).
        </p>
        {err ? <p className="cat__warn">{err}</p> : null}
        {items === null ? (
          <p className="cat__muted">Загрузка…</p>
        ) : (
          <ul className="cat__list">
            {items.map((p) => (
              <li key={p.slug} className="cat__item">
                <Link className="cat__link" to={`/${p.slug}`}>
                  {p.displayName || p.slug}
                </Link>
                <span className="cat__slug">/{p.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
