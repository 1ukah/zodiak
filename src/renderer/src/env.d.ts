/// <reference types="vite/client" />

import type { SharescreenApi } from '../../shared/types'
import type { ZodiakBridge } from '../../shared/zodiak'

declare global {
  interface Window {
    sharescreen: SharescreenApi
    zodiak: ZodiakBridge
  }
}

export {}
