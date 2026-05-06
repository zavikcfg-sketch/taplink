import { NavLink } from 'react-router-dom'
import './SiteNav.css'

const links = [
  { to: '/', label: 'Сайт' },
  { to: '/1', label: 'Редактор' },
  { to: '/profil', label: 'Профиль и настройки' },
  { to: '/pricing', label: 'Тарифы' },
]

export default function SiteNav() {
  return (
    <nav className="snav" aria-label="Главная навигация">
      <div className="snav__inner">
        <NavLink to="/" className="snav__brand">
          Taplink
        </NavLink>
        <div className="snav__links">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `snav__link${isActive ? ' snav__link--active' : ''}`}
              end={l.to === '/'}
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
