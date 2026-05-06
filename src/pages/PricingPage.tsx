import InternalLayout from '../components/InternalLayout'
import './CatalogPage.css'

export default function PricingPage() {
  return (
    <InternalLayout>
      <div className="cat">
        <main className="cat__main cat__main--shell">
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
    </InternalLayout>
  )
}
