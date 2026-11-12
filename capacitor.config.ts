import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The iPhone app (ios/): this same web app inside a native shell, so it can use what a web app
 * can't (see README, «App para iPhone»). Built by .github/workflows/ios.yml.
 */
const config: CapacitorConfig = {
  appId: 'io.github.puertamillet.strong2',
  appName: 'Strong 2.0',
  webDir: 'dist',
  ios: {
    // The page already leaves room for the status bar and the home indicator (safe-area CSS).
    contentInset: 'never',
    // A long press on a link (the tabs) doesn't open a preview of the page, as in a native app.
    allowsLinkPreview: false,
  },
}

export default config
