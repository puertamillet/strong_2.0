/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Address of the push server (push-server/), set by the deploy workflow; empty: no notifications. */
  readonly VITE_PUSH_URL?: string
}

/** Short commit id of this build (see vite.config.ts). */
declare const __APP_VERSION__: string
/** When this build was made, as an ISO date. */
declare const __BUILD_TIME__: string
