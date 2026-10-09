// Тема оформления: auto — следовать prefers-color-scheme, выбор хранится в localStorage.
// Применяется через data-theme на <html>, палитры — в index.css.
export type Theme = 'auto' | 'dark' | 'light'
const KEY = 'clawds.theme'

function detect(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light' || saved === 'auto') return saved
  } catch { /* без хранилища */ }
  return 'auto'
}

function resolved(t: Theme): 'dark' | 'light' {
  if (t !== 'auto') return t
  try {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch { /* нет matchMedia */ }
  return 'dark'
}

let theme: Theme = detect()
export const getTheme = () => theme

function apply() {
  document.documentElement.dataset.theme = resolved(theme)
}

export const setThemeValue = (t: Theme) => {
  theme = t
  try { localStorage.setItem(KEY, t) } catch { /* без хранилища */ }
  apply()
}

apply()
try {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (theme === 'auto') apply() })
} catch { /* нет matchMedia */ }
