import { useState } from 'react'
import { FolderOpen, Plus, X, ArrowLeft, GitBranch, Plug } from 'lucide-react'
import { useStore } from '../store'
import type { RecentSession } from '../types'
import { fmtAgo, folderName } from './ui'
import Connections, { LoginBar } from './Connections'
import { t, type Lang } from '../i18n'

export default function Launcher() {
  const { recent, inspectFolder, createSession, openSession, forgetSession, modal, setModal, conn, lang, setLang } = useStore()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ folder: string; isRepo: boolean; sessions: RecentSession[] } | null>(null)

  const open = async () => {
    if (!path.trim() || busy) return
    setBusy(true)
    const r = await inspectFolder(path)
    // Если в папке ещё не было сессий, сразу создаём первую; иначе даём выбрать
    if (r) { if (r.sessions.length === 0) await createSession(r.folder); else setFound(r) }
    setBusy(false)
  }

  const Row = ({ s, inFolder }: { s: RecentSession; inFolder?: boolean }) => (
    <div className={'rs-row' + (s.exists ? '' : ' gone')}>
      <button className="rs-main" disabled={!s.exists || busy} onClick={async () => { setBusy(true); await openSession(s.id); setBusy(false) }}>
        <span className="rs-ico"><FolderOpen size={18} /></span>
        <span className="grow">
          <b>{inFolder ? s.name : folderName(s.folder)}</b>
          <span className="sub rs-path">{s.exists ? (inFolder ? '' : s.folder) : t('папка не найдена')}</span>
          <span className="sub">{inFolder ? '' : s.name + ' · '}{s.bots} {s.bots === 1 ? t('бот') : t('ботов')} · {fmtAgo(s.opened)}</span>
        </span>
      </button>
      {!inFolder && <button className="icon-btn" title={t('Убрать из списка (данные сессии не удаляются)')} onClick={() => forgetSession(s.id)}><X size={16} /></button>}
    </div>
  )

  return (
    <div className="launcher">
      <div className="launch-card">
        <div className="lang-corner"><select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language"><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option></select></div>
        <LoginBar />
        <div className="brand"><span className="dots big"><u /><u /><u /></span><h1>Clawds</h1></div>
        <p className="lead-text">{t('Откройте папку проекта. Боты будут работать в ней. У каждой папки свои сессии с отдельными ботами и группами.')}</p>

        {!found ? (
          <>
            <div className="path-row">
              <FolderOpen size={18} />
              <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} placeholder={t('Например D:\\проекты\\мой-сайт')} />
              <button className="btn primary" disabled={!path.trim() || busy} onClick={open}>{t('Открыть')}</button>
            </div>
            <div className="sub hint-line"><GitBranch size={13} /> {t('Если в папке нет git, Clawds выполнит git init. Ваши файлы он не меняет.')}</div>
          </>
        ) : (
          <div className="found">
            <button className="back" onClick={() => setFound(null)}><ArrowLeft size={15} /> {t('Другая папка')}</button>
            <h3>{folderName(found.folder)}</h3>
            <div className="sub">{found.folder}</div>
            <div className="sub" style={{ margin: '14px 0 6px' }}>{t('В этой папке уже есть сессии:')}</div>
            {found.sessions.map((s) => <Row key={s.id} s={s} inFolder />)}
            <button className="btn primary wide-btn" disabled={busy} onClick={async () => { setBusy(true); await createSession(found.folder); setBusy(false) }}>
              <Plus size={16} /> {t('Новая пустая сессия')}
            </button>
          </div>
        )}

        <button className="btn wide-btn" onClick={() => setModal('connections')}><Plug size={16} /> {t('Подключения: Claude и свои эндпоинты')}{conn.providers.length ? ' (' + conn.providers.length + ')' : ''}</button>

        {!found && recent.length > 0 && (
          <div className="recent">
            <h3>{t('Недавние сессии')}</h3>
            {recent.map((s) => <Row key={s.id} s={s} />)}
          </div>
        )}
      </div>
      {modal === 'connections' && <Connections />}
    </div>
  )
}
