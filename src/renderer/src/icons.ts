import {
  ArrowRight, ChevronLeft, ChevronRight, Check, Eye, EyeOff, Headphones, HeadphoneOff, Mic, MicOff, LayoutGrid,
  Clock, Download, LoaderCircle, LogOut, Maximize, Minimize, Monitor, MonitorUp, PanelLeftClose,
  PictureInPicture2, Plus, RotateCw, Search, Server, Settings, Square, Users,
  Volume2, VolumeX, X, MessageCircle, Send, UserRound, Keyboard, Hash, LockKeyhole, ArrowDown, ExternalLink, Play, createElement, type IconNode,
} from 'lucide'

const icons: Record<string, IconNode> = {
  monitor: Monitor, share: MonitorUp, rooms: LayoutGrid, plus: Plus,
  search: Search, settings: Settings, people: Users, headphones: Headphones,
  server: Server,
  mic: Mic, 'mic-off': MicOff, 'headphones-off': HeadphoneOff,
  expand: Maximize, collapse: Minimize, popout: PictureInPicture2, focus: PanelLeftClose,
  eye: Eye, 'eye-off': EyeOff, stop: Square, leave: LogOut, close: X,
  refresh: RotateCw, arrow: ArrowRight, check: Check, volume: Volume2,
  'volume-off': VolumeX, loader: LoaderCircle,
  chat: MessageCircle, send: Send, account: UserRound, keyboard: Keyboard,
  hash: Hash, private: LockKeyhole, down: ArrowDown, link: ExternalLink, play: Play,
  download: Download, later: Clock,
  attach: Plus,
  previous: ChevronLeft, next: ChevronRight,
}

const markup = new Map<string, string>()
export function icon(name: string): string {
  const cached = markup.get(name)
  if (cached) return cached
  const svg = createElement(icons[name] ?? Monitor, {
    class: 'icon', 'stroke-width': 1.75, 'aria-hidden': 'true', focusable: 'false',
  }).outerHTML
  markup.set(name, svg)
  return svg
}

export function setButtonIcon(button: HTMLElement, name: string): void {
  if (button.dataset.renderedIcon === name) return
  button.innerHTML = icon(name)
  button.dataset.renderedIcon = name
}

export function hydrateIcons(): void {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon!)
  })
}

export function labelButton(button: HTMLButtonElement, label: string): void {
  button.title = label
  button.setAttribute('aria-label', label)
}
