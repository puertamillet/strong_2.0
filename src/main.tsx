import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { requestPersistence } from './db'
import './index.css'
import { checkNativePlugins } from './lib/native'
import { checkPushSubscription, followNotifications } from './lib/push'
import { keepAppUpdated } from './lib/pwa'
import { seedIfEmpty } from './seed'

void seedIfEmpty()
void requestPersistence()
keepAppUpdated()
void checkPushSubscription()
followNotifications()
checkNativePlugins()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
