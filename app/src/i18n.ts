// Локализация: русские строки служат ключами, английский берётся из locales/en.ts,
// испанский — из locales/es.ts.
// Строка без перевода показывается как есть. Параметры: t('Ботов: {n}', { n: 3 }).
import { EN } from './locales/en'
import { ES } from './locales/es'

export type Lang = 'ru' | 'en' | 'es'
const KEY = 'clawds.lang'

const DICTS: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { en: EN, es: ES }

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'ru' || saved === 'en' || saved === 'es') return saved
  } catch { /* без хранилища */ }
  if (typeof navigator !== 'undefined') {
    if (/^ru\b/i.test(navigator.language)) return 'ru'
    if (/^es\b/i.test(navigator.language)) return 'es'
  }
  return 'en'
}

let lang: Lang = detect()
export const getLang = () => lang
export const setLangValue = (l: Lang) => {
  lang = l
  try { localStorage.setItem(KEY, l) } catch { /* без хранилища */ }
  document.documentElement.lang = l
}
document.documentElement.lang = lang

export function t(s: string, p?: Record<string, string | number>): string {
  let r = lang === 'ru' ? s : DICTS[lang][s] ?? s
  if (p) r = r.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''))
  return r
}

export const locale = () => (lang === 'ru' ? 'ru-RU' : lang === 'es' ? 'es-ES' : 'en-US')
