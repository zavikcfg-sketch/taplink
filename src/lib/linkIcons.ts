/** Короткая метка под доменом ссылки (без внешних SVG-логотипов — только текст). */
export function linkDomainHint(url: string): string | null {
  try {
    const u = new URL(url.trim())
    const h = u.hostname.replace(/^www\./, '').toLowerCase()
    const map: Record<string, string> = {
      'youtube.com': 'YouTube',
      'youtu.be': 'YouTube',
      'tiktok.com': 'TikTok',
      'instagram.com': 'Instagram',
      'twitch.tv': 'Twitch',
      'kick.com': 'Kick',
      'twitter.com': 'X',
      'x.com': 'X',
      'telegram.me': 'TG',
      't.me': 'TG',
      'discord.gg': 'Discord',
      'discord.com': 'Discord',
      'boosty.to': 'Boosty',
      'donationalerts.com': 'Донаты',
      'donate.stream': 'Донаты',
      'patreon.com': 'Patreon',
      'github.com': 'GitHub',
      'vk.com': 'VK',
      'soundcloud.com': 'SoundCloud',
      'spotify.com': 'Spotify',
      'music.yandex.ru': 'Я.Музыка',
      'band.link': 'Music',
    }
    for (const [k, v] of Object.entries(map)) {
      if (h === k || h.endsWith(`.${k}`)) return v
    }
    return null
  } catch {
    return null
  }
}
