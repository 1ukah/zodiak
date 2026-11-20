/** Keys that work as a keybind on their own. Others need Ctrl, Alt, Shift or Super, so typing is not taken over. */
const STANDALONE = /^(F([1-9]|1[0-9]|2[0-4])|Scrolllock|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause)$/

const NAMED: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  ScrollLock: 'Scrolllock',
  AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute',
  MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop', MediaPlayPause: 'MediaPlayPause',
}

export type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

export type RecordedKey = { accelerator: string } | { error: string } | null

function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return NAMED[code]
}

/** The Electron accelerator for a key press, or `null` while only modifiers are held. */
export function acceleratorFromKey(event: KeyPress): RecordedKey {
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(event.code)) return null
  const key = keyName(event.code)
  if (!key) return { error: 'This key cannot be used as a keybind.' }
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter((value): value is string => Boolean(value))
  if (!modifiers.length && !STANDALONE.test(key)) return { error: 'Add Ctrl, Alt or Shift to this key.' }
  return { accelerator: [...modifiers, key].join('+') }
}

/** A readable label for a saved accelerator. */
export function formatAccelerator(accelerator: string): string {
  if (!accelerator) return 'Not set'
  return accelerator.split('+').map((part) => part.replace(/^num(\d)$/, 'Numpad $1').replace(/^num(add|sub|mult|div|dec)$/, (_, name: string) => `Numpad ${{ add: '+', sub: '-', mult: '*', div: '/', dec: '.' }[name]}`)).join(' + ')
}
