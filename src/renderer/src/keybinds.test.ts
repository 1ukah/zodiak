import { describe, expect, it } from 'vitest'
import { acceleratorFromKey, formatAccelerator } from './keybinds'

const press = (code: string, modifiers: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  acceleratorFromKey({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers })

describe('keybinds', () => {
  it('turns key presses into Electron accelerators', () => {
    expect(press('KeyM', { ctrlKey: true, shiftKey: true })).toEqual({ accelerator: 'Ctrl+Shift+M' })
    expect(press('Digit4', { altKey: true })).toEqual({ accelerator: 'Alt+4' })
    expect(press('Numpad7', { ctrlKey: true })).toEqual({ accelerator: 'Ctrl+num7' })
    expect(press('F13')).toEqual({ accelerator: 'F13' })
    expect(press('MediaPlayPause')).toEqual({ accelerator: 'MediaPlayPause' })
  })

  it('waits while only modifiers are held', () => {
    expect(press('ControlLeft', { ctrlKey: true })).toBeNull()
    expect(press('ShiftRight', { shiftKey: true })).toBeNull()
  })

  it('does not take over typing keys without a modifier', () => {
    expect(press('KeyM')).toHaveProperty('error')
    expect(press('Space')).toHaveProperty('error')
    expect(press('IntlBackslash', { ctrlKey: true })).toHaveProperty('error')
  })

  it('shows readable labels', () => {
    expect(formatAccelerator('Ctrl+Shift+M')).toBe('Ctrl + Shift + M')
    expect(formatAccelerator('Alt+num7')).toBe('Alt + Numpad 7')
    expect(formatAccelerator('')).toBe('Not set')
  })
})
