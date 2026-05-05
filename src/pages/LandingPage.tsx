import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TelegramGlyph } from '../components/TelegramGlyph'
import { loadProfile } from '../lib/profileStorage'
import '../App.css'

const START_REGISTER = 'register'
const START_RETURN = 'return'

function botUsername() {
  const raw = import.meta.env.VITE_BOT_USERNAME?.trim() || ''
  return raw.replace(/^@/, '')
}

function telegramDeepLink(start: string) {
  const u = botUsername()
  if (!u) return null
  return `https://t.me/${u}?start=${encodeURIComponent(start)}`
}

export default function LandingPage() {
  const [hasProfile] = useState(() => loadProfile() !== null)
  const bot = botUsername()
  const linkRegister = telegramDeepLink(START_REGISTER)
  const linkReturn = telegramDeepLink(START_RETURN)

  return (
    <div className="home">
      <div className="home__glow home__glow--1" aria-hidden />
      <div className="home__glow home__glow--2" aria-hidden />
      <div className="home__glow home__glow--3" aria-hidden />
      <div className="home__grid" aria-hidden />
      <div className="home__noise" aria-hidden />

      <header className="home__top">
        <Link to="/" className="home__logo home__logoLink">
          <span className="home__logoMark" aria-hidden />
          Taplink
        </Link>
        <div className="home__topActions">
          {hasProfile ? (
            <Link className="home__topLink home__topLink--muted" to="/edit">
              Редактор
            </Link>
          ) : null}
          {bot ? (
            <a className="home__topLink" href={linkRegister ?? '#'} target="_blank" rel="noreferrer">
              Вход в бота
            </a>
          ) : null}
        </div>
      </header>

      <main className="home__main">
        <div className="home__layout">
          <div className="home__heroCol">
            <div className="home__heroCard">
              <p className="home__eyebrow">Ссылка в био — без лишних сервисов</p>
              <h1 className="home__title">
                Ваша страница
                <span className="home__titleAccent"> как Taplink</span>
                <span className="home__titleLine">для TikTok, YouTube и соцсетей</span>
              </h1>
              <p className="home__lead">
                Один аккуратный адрес в шапке профиля: аватар, текст, кнопки на стримы, магазин,
                донаты — и <strong>свой фон</strong> (фото или короткое видео). Редактор в Telegram Mini
                App, публикация в один тап.
              </p>

              <p className="home__valueLine">
                <strong>За ~30 секунд:</strong> имя, описание, ссылки — и можно кидать ссылку подписчикам.
                Счётчики переходов по кнопкам видно на публичной странице.
              </p>

              <div className="home__chips" aria-label="Платформы">
                <span className="home__chip">TikTok</span>
                <span className="home__chip">YouTube</span>
                <span className="home__chip">Shorts</span>
                <span className="home__chip">Reels</span>
                <span className="home__chip">Twitch</span>
              </div>

              <div className="home__actions">
                {linkRegister ? (
                  <a
                    className="home__btn home__btn--primary"
                    href={linkRegister}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <TelegramGlyph />
                    Создать страницу
                  </a>
                ) : (
                  <span className="home__btn home__btn--disabled">
                    Задайте VITE_BOT_USERNAME при сборке
                  </span>
                )}

                {linkReturn ? (
                  <a
                    className="home__btn home__btn--ghost"
                    href={linkReturn}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <TelegramGlyph />
                    Уже есть аккаунт
                  </a>
                ) : null}

                {hasProfile ? (
                  <Link className="home__btn home__btn--ghost" to="/edit">
                    Открыть редактор
                  </Link>
                ) : null}
              </div>

              {!bot ? (
                <p className="home__note">
                  Для кнопок укажите имя бота в <code>.env</code>:{' '}
                  <code>VITE_BOT_USERNAME=имя_бота</code>, затем <code>npm run build</code>.
                </p>
              ) : (
                <p className="home__note">
                  После сохранения в редакторе ссылка вида <code>ваш-сайт/ник</code> открывается у
                  всех в браузере — не только у вас в Telegram.
                </p>
              )}
            </div>
          </div>

          <div className="home__sideCol">
            <ul className="home__features">
              <li className="home__feat">
                <span className="home__featIcon" aria-hidden>
                  ◎
                </span>
                <div>
                  <strong>Фон фото или видео</strong>
                  <span>Подложка на весь экран за карточкой — как у топовых лендингов в био.</span>
                </div>
              </li>
              <li className="home__feat">
                <span className="home__featIcon" aria-hidden>
                  ◇
                </span>
                <div>
                  <strong>Кнопки под ваш контент</strong>
                  <span>Релизы, коллабы, мерч, донаты — всё в одном списке ссылок.</span>
                </div>
              </li>
              <li className="home__feat">
                <span className="home__featIcon" aria-hidden>
                  ✦
                </span>
                <div>
                  <strong>Через Telegram</strong>
                  <span>Регистрация в боте, правки в Mini App, без отдельного пароля от сайта.</span>
                </div>
              </li>
            </ul>

            <ol className="home__steps">
              <li>
                <span className="home__stepNum">1</span>
                <div>
                  <strong>Старт в боте</strong>
                  <span>Команда /start и короткая настройка</span>
                </div>
              </li>
              <li>
                <span className="home__stepNum">2</span>
                <div>
                  <strong>Оформление</strong>
                  <span>Mini App: текст, ссылки, аватар и фон</span>
                </div>
              </li>
              <li>
                <span className="home__stepNum">3</span>
                <div>
                  <strong>Ссылка в био</strong>
                  <span>
                    Копируйте <code>сайт/ваш-slug</code> в описание профиля
                  </span>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </main>

      <footer className="home__foot">
        <span>Taplink-style</span>
        <span className="home__dot">·</span>
        <span>Одна страница — весь вас в одной ссылке</span>
      </footer>
    </div>
  )
}
