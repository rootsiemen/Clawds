import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme'
import './extra.css'
import './polish.css'
import './sessions.css'
import './toolgroup.css'
import './markdown.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
