/** Превращает ввод пользователя в абсолютный https URL или null. */
export function normalizeHttpUrl(raw: string): string | null {
  const u = raw.trim()
  if (!u) return null
  try {
    return new URL(u.includes('://') ? u : `https://${u}`).href
  } catch {
    return null
  }
}
