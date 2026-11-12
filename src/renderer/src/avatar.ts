/** Up to two initials, from the first two words of the name. */
export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0] ?? '').join('').toUpperCase() || '?'
}

/** A stable color for a name, so a person has the same avatar color everywhere. */
export function avatarHue(name: string): number {
  return [...name].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 360, 252)
}

export function makeAvatar(name: string, className = ''): HTMLSpanElement {
  const avatar = Object.assign(document.createElement('span'), { className: `avatar ${className}`.trim(), textContent: initials(name) })
  avatar.style.setProperty('--avatar-hue', String(avatarHue(name)))
  avatar.setAttribute('aria-hidden', 'true')
  return avatar
}
