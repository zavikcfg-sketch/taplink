import list from '../config/reserved-slugs.json'

export const RESERVED_SLUGS = new Set(
  (list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean),
)
