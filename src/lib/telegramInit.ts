/** Строка initData для заголовка X-Telegram-Init-Data (валидация на сервере). */
export function getTelegramInitData(): string | null {
  const w = window as Window & {
    Telegram?: { WebApp?: { initData?: string } }
  }
  const raw = w.Telegram?.WebApp?.initData
  return raw && raw.length > 0 ? raw : null
}

export function isTelegramWebApp(): boolean {
  return getTelegramInitData() !== null
}
