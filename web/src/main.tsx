import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

// Sau mỗi lần deploy, tab đang mở có thể trỏ tới chunk cũ đã bị xóa → tải lại trang một lần
window.addEventListener('vite:preloadError', (event) => {
  const key = 'qtr-chunk-reload-at'
  const last = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - last < 10_000) return
  sessionStorage.setItem(key, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename === '/' ? undefined : basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
