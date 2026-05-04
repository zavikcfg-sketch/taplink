import './App.css'

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

function TelegramGlyph() {
  return (
    <svg className="tgIcon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M21.944 5.518c-.23 1.676-1.226 6.215-1.733 8.242-.215.9-.637 1.2-1.05 1.23-.893.083-1.57-.59-2.438-1.155-1.354-.89-2.12-1.442-3.43-2.31-1.52-.99-.535-1.533.332-2.422.23-.234 4.215-3.86 4.292-4.19.01-.043.018-.204-.076-.29-.094-.084-.233-.055-.334-.032-.142.032-2.403 1.525-6.78 4.48-.642.44-1.224.654-1.747.643-.575-.01-1.68-.363-2.503-.662-1.01-.37-1.812-.566-1.742-1.194.035-.328.492-.664 1.363-1.01 5.35-2.33 8.92-3.86 10.7-4.63 5.09-2.15 6.15-2.52 6.84-2.55.15-.007.486-.033.704.1.164.1.21.295.232.413.022.12.05.39.028.6z"
      />
    </svg>
  )
}

export default function App() {
  const bot = botUsername()
  const linkRegister = telegramDeepLink(START_REGISTER)
  const linkReturn = telegramDeepLink(START_RETURN)

  return (
    <div className="home">
      <div className="home__glow home__glow--1" aria-hidden />
      <div className="home__glow home__glow--2" aria-hidden />
      <div className="home__grid" aria-hidden />

      <header className="home__top">
        <span className="home__logo">Taplink</span>
        {bot ? (
          <a className="home__topLink" href={linkRegister ?? '#'} target="_blank" rel="noreferrer">
            Вход в бота
          </a>
        ) : null}
      </header>

      <main className="home__main">
        <p className="home__eyebrow">Страница со ссылками за пару минут</p>
        <h1 className="home__title">
          Создайте профиль
          <span className="home__titleAccent"> через Telegram</span>
        </h1>
        <p className="home__lead">
          Нажмите «Регистрация» — откроется бот. После /start вы сможете открыть редактор
          (Mini App) и настроить свою публичную страницу.
        </p>

        <div className="home__actions">
          {linkRegister ? (
            <a
              className="home__btn home__btn--primary"
              href={linkRegister}
              target="_blank"
              rel="noreferrer"
            >
              <TelegramGlyph />
              Регистрация в боте
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
              Уже регистрировался
            </a>
          ) : null}
        </div>

        {!bot ? (
          <p className="home__note">
            Для кнопок укажите имя бота в файле <code>.env</code>:{' '}
            <code>VITE_BOT_USERNAME=имя_бота</code>, затем выполните{' '}
            <code>npm run build</code>.
          </p>
        ) : (
          <p className="home__note">
            Ссылки ведут в Telegram с меткой <code>start</code>, чтобы бот понимал контекст
            (новый пользователь или возвращающийся).
          </p>
        )}

        <ol className="home__steps">
          <li>
            <span className="home__stepNum">1</span>
            <div>
              <strong>Регистрация</strong>
              <span>Переход в бота и команда /start</span>
            </div>
          </li>
          <li>
            <span className="home__stepNum">2</span>
            <div>
              <strong>Редактор</strong>
              <span>Кнопка Mini App в боте — оформление страницы</span>
            </div>
          </li>
          <li>
            <span className="home__stepNum">3</span>
            <div>
              <strong>Публикация</strong>
              <span>Делитесь адресом вида <code>сайт/ваш-slug</code></span>
            </div>
          </li>
        </ol>
      </main>

      <footer className="home__foot">
        <span>Taplink-style</span>
        <span className="home__dot">·</span>
        <span>Без Telegram кнопки регистрации не заработают</span>
      </footer>
    </div>
  )
}
