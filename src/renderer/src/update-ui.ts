import type { SharescreenApi, UpdateAction, UpdateState } from '../../shared/types'
import { icon } from './icons'

/** A single modal follows the main process state, including renderer reloads. */
export function initializeUpdateUI(api: SharescreenApi): void {
  const dialog = document.querySelector<HTMLDialogElement>('#update-dialog')!
  const title = document.querySelector<HTMLElement>('#update-title')!
  const version = document.querySelector<HTMLElement>('#update-version')!
  const download = document.querySelector<HTMLElement>('#update-download')!
  const progress = document.querySelector<HTMLProgressElement>('#update-progress')!
  const percent = document.querySelector<HTMLElement>('#update-percent')!
  const size = document.querySelector<HTMLElement>('#update-size')!
  const error = document.querySelector<HTMLElement>('#update-error')!
  const actions = document.querySelector<HTMLElement>('#update-actions')!
  const primary = document.querySelector<HTMLButtonElement>('#update-primary')!
  const later = document.querySelector<HTMLButtonElement>('#update-later')!
  const close = document.querySelector<HTMLButtonElement>('#update-close')!
  let state: UpdateState = { revision: -1, phase: 'idle', visible: false, channel: 'stable' }
  let pendingPhase: UpdateState['phase'] | null = null
  const busy = () => ['checking', 'downloading', 'installing'].includes(state.phase)
  const labels: Record<UpdateState['phase'], string> = {
    idle: '', checking: 'Checking…', available: 'Update available', downloading: 'Downloading…',
    downloaded: 'Update ready', installing: 'Restarting…', current: 'Up to date', error: 'Could not update',
  }

  function render(next: UpdateState): void {
    if (next.revision < state.revision) return
    const previousPhase = state.phase
    state = next
    if (!state.visible || state.phase === 'idle') { if (dialog.open) dialog.close(); return }
    title.textContent = labels[state.phase]
    version.textContent = state.version ? `v${state.version}` : 'zodiak'
    close.hidden = busy()
    actions.hidden = busy()
    download.hidden = !busy()
    error.hidden = state.phase !== 'error'
    error.textContent = state.error ?? ''
    const measured = state.phase === 'downloading' && state.progress
    if (measured) {
      progress.value = Math.min(100, Math.max(0, measured.percent))
      percent.textContent = `${Math.floor(progress.value)}%`
      size.textContent = measured.total > 0 ? `${mb(measured.transferred)} / ${mb(measured.total)} MB` : ''
      size.title = measured.bytesPerSecond > 0 ? `${mb(measured.bytesPerSecond)} MB/s` : ''
    } else {
      progress.removeAttribute('value')
      percent.textContent = ''
      size.textContent = ''
      size.title = ''
    }
    primary.disabled = pendingPhase === state.phase
    later.hidden = state.phase === 'current'
    const action = state.phase === 'available' ? ['download', 'Download', 'Download update'] :
      state.phase === 'downloaded' ? ['refresh', 'Restart', 'Restart and install update'] :
      state.phase === 'error' ? ['refresh', 'Retry', 'Retry update'] : ['check', '', 'Done']
    // Markup is built only from these fixed labels and our bundled icons.
    primary.innerHTML = icon(action[0]) + (action[1] ? `<span>${action[1]}</span>` : '')
    primary.title = action[2]
    primary.setAttribute('aria-label', action[2])
    if (!dialog.open) { dialog.showModal(); if (busy()) dialog.focus(); else primary.focus() }
    else if (previousPhase !== state.phase && !busy()) primary.focus()
  }

  async function act(action: UpdateAction): Promise<void> {
    if (pendingPhase === state.phase) return
    pendingPhase = state.phase
    primary.disabled = true
    try {
      const result = await api.updateAction(action)
      if (!result.ok) { error.textContent = result.error; error.hidden = false }
    } catch {
      error.textContent = 'Please try again.'
      error.hidden = false
    } finally {
      pendingPhase = null
      primary.disabled = false
    }
  }
  primary.addEventListener('click', () => {
    if (busy()) return
    void act(state.phase === 'available' ? 'download' : state.phase === 'downloaded' ? 'install' : state.phase === 'error' ? 'retry' : 'dismiss')
  })
  const dismiss = () => { if (!busy()) void act('dismiss') }
  close.addEventListener('click', dismiss)
  later.addEventListener('click', dismiss)
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss() })
  // Some test/preview hosts do not provide the packaged-app updater bridge.
  if (!api.onUpdateStateChanged || !api.getUpdateState) return
  const unsubscribe = api.onUpdateStateChanged(render)
  window.addEventListener('pagehide', unsubscribe, { once: true })
  void api.getUpdateState().then(render).catch(() => {})
}

function mb(bytes: number): string { return (bytes / 1_000_000).toFixed(1) }
