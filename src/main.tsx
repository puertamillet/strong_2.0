import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { requestPersistence } from './db'
import './index.css'
import { keepAppUpdated } from './lib/pwa'
import { seedIfEmpty } from './seed'

void seedIfEmpty()
void requestPersistence()
keepAppUpdated()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
