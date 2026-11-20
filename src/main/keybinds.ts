import { BrowserWindow, globalShortcut } from 'electron'
import { channels, KEYBIND_ACTIONS, type KeybindAction, type Keybinds } from '../shared/types'

let current: Keybinds = { mute: '', deafen: '' }
let paused = false

/** Registers the keybinds system-wide, so they work while another app has focus. Returns the ones that failed. */
export function applyKeybinds(keybinds: Keybinds): KeybindAction[] {
  current = { ...keybinds }
  return register()
}

/** While the user records a new keybind, the current ones must not swallow the keys. */
export function pauseKeybinds(value: boolean): void {
  if (paused === value) return
  paused = value
  register()
}

export function clearKeybinds(): void {
  globalShortcut.unregisterAll()
}

function register(): KeybindAction[] {
  globalShortcut.unregisterAll()
  if (paused) return []
  const failed: KeybindAction[] = []
  for (const action of KEYBIND_ACTIONS) {
    const accelerator = current[action]
    if (!accelerator) continue
    try {
      if (!globalShortcut.register(accelerator, () => notify(action))) failed.push(action)
    } catch { failed.push(action) }
  }
  return failed
}

function notify(action: KeybindAction): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channels.keybindPressed, action)
  }
}
