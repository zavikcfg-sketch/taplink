import type { ThemeId } from '../types/profile'

export const THEME_IDS: ThemeId[] = ['purple', 'ocean', 'sunset', 'mono', 'light']

export const THEME_LABELS: Record<ThemeId, string> = {
  purple: 'Неон фиолет',
  ocean: 'Океан',
  sunset: 'Закат',
  mono: 'Моно',
  light: 'Светлая карточка',
}

export function normalizeThemeId(raw: string | undefined): ThemeId {
  const t = (raw || 'purple').toLowerCase()
  return THEME_IDS.includes(t as ThemeId) ? (t as ThemeId) : 'purple'
}
