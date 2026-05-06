import { Link } from 'react-router-dom'
import InternalLayout from '../components/InternalLayout'
import { loadProfile } from '../lib/profileStorage'
import './CatalogPage.css'

export default function ProfileHubPage() {
  const local = loadProfile()
  const publicUrl = local?.slug ? `/${local.slug}` : null

  return (
    <InternalLayout>
      <div className="cat">
        <main className="cat__main cat__main--shell">
        <h1 className="cat__title">Профиль и настройки</h1>
        <p className="cat__lead">Управление вашей страницей в обычном браузере.</p>

        <ul className="cat__list">
          <li className="cat__item">
            <Link className="cat__link" to="/1">
              Редактировать профиль
            </Link>
            <span className="cat__slug">Имя, био, ссылки, фон, тема, тариф.</span>
          </li>
          <li className="cat__item">
            <Link className="cat__link" to="/pricing">
              Тарифы и VIP
            </Link>
            <span className="cat__slug">Сравнение Free/VIP и дополнительные функции.</span>
          </li>
          {publicUrl ? (
            <li className="cat__item">
              <Link className="cat__link" to={publicUrl}>
                Открыть публичную страницу
              </Link>
              <span className="cat__slug">{publicUrl}</span>
            </li>
          ) : null}
        </ul>
        </main>
      </div>
    </InternalLayout>
  )
}
