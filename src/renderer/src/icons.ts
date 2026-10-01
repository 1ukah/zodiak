import {
  ArrowRight, Check, Eye, EyeOff, Headphones, LayoutGrid,
  LoaderCircle, LogOut, Maximize, Monitor, MonitorUp, PanelLeftClose,
  PictureInPicture2, Plus, RotateCw, Search, Server, Settings, Square, Users,
  Volume2, VolumeX, X, MessageCircle, Send, PanelRight, PanelBottom, Hash, LockKeyhole, ArrowDown, ExternalLink, Play, createElement, type IconNode,
} from 'lucide'

const icons: Record<string, IconNode> = {
  monitor: Monitor, share: MonitorUp, rooms: LayoutGrid, plus: Plus,
  search: Search, settings: Settings, people: Users, headphones: Headphones,
  server: Server,
  expand: Maximize, popout: PictureInPicture2, focus: PanelLeftClose,
  eye: Eye, 'eye-off': EyeOff, stop: Square, leave: LogOut, close: X,
  refresh: RotateCw, arrow: ArrowRight, check: Check, volume: Volume2,
  'volume-off': VolumeX, loader: LoaderCircle,
  chat: MessageCircle, send: Send, 'chat-right': PanelRight, 'chat-bottom': PanelBottom,
  hash: Hash, private: LockKeyhole, down: ArrowDown, link: ExternalLink, play: Play,
}

export function icon(name: string): string {
  return createElement(icons[name] ?? Monitor, {
    class: 'icon', 'stroke-width': 1.75, 'aria-hidden': 'true', focusable: 'false',
  }).outerHTML
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
