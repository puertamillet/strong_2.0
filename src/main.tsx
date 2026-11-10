import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { requestPersistence } from './db'
import './index.css'
import { checkPushSubscription } from './lib/push'
import { keepAppUpdated } from './lib/pwa'
import { seedIfEmpty } from './seed'

void seedIfEmpty()
void requestPersistence()
keepAppUpdated()
void checkPushSubscription()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
