/// <reference types="vite/client" />

import type { SharescreenApi } from '../../shared/types'

declare global {
  interface Window {
    sharescreen: SharescreenApi
  }
}

export {}
