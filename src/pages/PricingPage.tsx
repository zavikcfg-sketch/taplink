import { Link } from 'react-router-dom'
import './CatalogPage.css'

export default function PricingPage() {
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
          Открыть редактор
        </Link>
      </header>
      <main className="cat__main">
        <h1 className="cat__title">Тарифы</h1>
        <p className="cat__lead">Выберите тариф под вашу страницу и нагрузку.</p>

        <ul className="cat__list">
          <li className="cat__item">
            <strong>Free — 0 ₽/мес</strong>
            <span className="cat__slug">До 8 ссылок, QR, темы, фоновое видео без звука.</span>
          </li>
          <li className="cat__item">
            <strong>VIP — 299 ₽/мес</strong>
            <span className="cat__slug">До 30 ссылок, видео со звуком, VIP-бейдж, приоритет в каталоге.</span>
          </li>
          <li className="cat__item">
            <strong>VIP+ (план)</strong>
            <span className="cat__slug">Свой домен, UTM-аналитика, A/B обложек, экспорт отчётов.</span>
          </li>
        </ul>
      </main>
    </div>
  )
}
