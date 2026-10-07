import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, Modal, Toggle, authorName, fmtReset, fmtSize } from './ui'
import { AccountModal, AccountsModal, ProfileModal } from './Accounts'
import { EffortSelect, ModelSelect } from './ModelPick'
import Connections, { LoginBar } from './Connections'
import Tools from './Tools'
import { t } from '../i18n'

function CreateBot() {
  const { createBot, generatePrompt, setModal, bots } = useStore()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sonnet')
  const [effort, setEffort] = useState('default')
  const [busy, setBusy] = useState<'' | 'gen' | 'create'>('')
  const taken = bots.some((b) => b.name === name.trim().toLowerCase())

  // Haiku придумывает подробный промпт из названия и пары предложений
  const gen = async () => {
    setBusy('gen')
    const p = await generatePrompt(name.trim(), role)
    if (p) setPrompt(p)
    setBusy('')
  }
  // Если промпт не писали и описание есть, он придумывается при создании
  const create = async () => {
    setBusy('create')
    let p = prompt
    if (!p.trim() && role.trim()) p = (await generatePrompt(name.trim(), role)) ?? ''
    await createBot(name, role, model, effort, p)
    setBusy('')
  }

  return (
    <Modal title={t('Новый бот')} onClose={() => setModal(null)} wide>
      <label>{t('Название')}</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('например, video-assembler')} />
      {taken && <div className="err">{t('Такой бот уже есть')}</div>}
      <label>{t('Что он делает (одно-два предложения)')}</label>
      <textarea value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('Например: собирает видео из готовых медиа и инфографики')} rows={2} />
      <div className="gen-row">
        <button className="btn" disabled={!name.trim() || busy !== ''} onClick={gen}>{busy === 'gen' ? t('Придумываю…') : t('Придумать системный промпт')}</button>
        <span className="sub">{t('Haiku напишет подробный промпт на 5 предложений, его можно править')}</span>
      </div>
      <label>{t('Системный промпт (роль)')}</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('Пусто: при создании придумается автоматически из описания')} rows={6} />
      <div className="two-col">
        <div><label>{t('Модель')}</label><ModelSelect value={model} onChange={setModel} /></div>
        <div><label>{t('Размышления')}</label><EffortSelect value={effort} model={model} onChange={setEffort} /></div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={() => setModal(null)}>{t('Отмена')}</button>
        <button className="btn primary" disabled={!name.trim() || taken || busy !== ''} onClick={create}>{busy === 'create' ? t('Создаю…') : t('Создать')}</button>
      </div>
    </Modal>
  )
}

function CreateGroup() {
  const { createGroup, setModal, bots } = useStore()
  const [name, setName] = useState('')
  const [sel, setSel] = useState<string[]>([])
  return (
    <Modal title={t('Новая группа')} onClose={() => setModal(null)}>
      <label>{t('Название')}</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('например, release')} />
      <label>{t('Участники')}</label>
      <div className="check-list">
        {bots.map((b) => (
          <label className="check" key={b.id}>
            <input type="checkbox" checked={sel.includes(b.id)} onChange={() => setSel(sel.includes(b.id) ? sel.filter((x) => x !== b.id) : [...sel, b.id])} />
            <Avatar id={b.id} size={22} /> {b.name}
          </label>
        ))}
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={() => setModal(null)}>{t('Отмена')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={() => createGroup(name, sel)}>{t('Создать')}</button>
      </div>
    </Modal>
  )
}

function Bar({ label, pct, reset }: { label: string; pct: number; reset: number }) {
  const cls = pct >= 85 ? 'red' : pct >= 65 ? 'yellow' : ''
  return (
    <div className="qbig">
      <div className="qhead"><b>{label}</b><span>{pct > 0 || reset ? Math.round(pct) + '%' : '—'} · {t('сброс через')} {fmtReset(reset)}</span></div>
      <div className={'bar big ' + cls}><i style={{ width: pct + '%' }} /></div>
    </div>
  )
}

// Числовое поле: можно стереть и набрать заново, значение применяется, когда оно корректно, и подтягивается к допустимым границам
function NumRow({ label, sub, value, min, max, onCommit }: { label: string; sub?: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const fix = (raw: string) => {
    const n = Math.round(Number(raw))
    return raw.trim() === '' || Number.isNaN(n) ? null : Math.min(max, Math.max(min, n))
  }
  return (
    <div className="set-row">
      <div><b>{label}</b>{sub && <div className="sub">{sub}</div>}</div>
      <input
        type="number" min={min} max={max} value={text}
        onChange={(e) => { setText(e.target.value); const v = fix(e.target.value); if (v !== null && v !== value) onCommit(v) }}
        onBlur={() => { const v = fix(text); setText(String(v ?? value)); if (v !== null && v !== value) onCommit(v) }}
      />
    </div>
  )
}

function LangRow() {
  const { lang, setLang } = useStore()
  return (
    <div className="set-row">
      <div><b>{t('Язык интерфейса')}</b><div className="sub">{t('Боты тоже будут отвечать на этом языке')}</div></div>
      <select value={lang} onChange={(e) => setLang(e.target.value as 'ru' | 'en')}>
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </div>
  )
}

function SettingsModal() {
  const { quota, settings, setSettings, setModal, bots, stopAll } = useStore()
  const total = bots.reduce((a, b) => a + b.runsToday, 0) || 1
  return (
    <Modal title={t('Настройки')} onClose={() => setModal(null)} wide>
      <LoginBar />
      <button className="btn" onClick={() => setModal('account')}>{t('Мой аккаунт, юзернейм и номер')}</button>
      <button className="btn" onClick={() => setModal('connections')}>{t('Подключения: вход в Claude и свои эндпоинты')}</button>
      <button className="btn" onClick={() => setModal('tools')}>{t('Инструменты и навыки: MCP, импорт из других агентов')}</button>
      <button className="btn danger" onClick={stopAll}>{t('Остановить всех ботов')}</button>
      <LangRow />
      <h3>{t('Квота Claude')}</h3>
      <Bar label={t('5-часовое окно')} pct={quota.fiveHour.pct} reset={quota.fiveHour.resetsAt} />
      <Bar label={t('Недельный лимит')} pct={quota.sevenDay.pct} reset={quota.sevenDay.resetsAt} />
      <h3>{t('Расход по ботам (запуски сегодня)')}</h3>
      {[...bots].sort((a, b) => b.runsToday - a.runsToday).map((b) => (
        <div className="usage-row" key={b.id}>
          <Avatar id={b.id} size={20} /> <span className="w80">{b.name}</span>
          <div className="bar"><i style={{ width: (b.runsToday / total) * 100 + '%', background: b.color }} /></div>
          <b>{b.runsToday}</b>
        </div>
      ))}
      <h3>{t('Права и инструменты')}</h3>
      <div className="set-row"><div><b>{t('Полный доступ без подтверждений')}</b><div className="sub">{t('bypassPermissions для всех ботов')}</div></div><Toggle on={settings.fullAccess} onChange={(v) => setSettings({ fullAccess: v })} /></div>
      <div className="set-row"><div><b>Computer use</b><div className="sub">{t('Управление рабочим столом')}</div></div><Toggle on={settings.computerUse} onChange={(v) => setSettings({ computerUse: v })} /></div>
      <div className="set-row"><div><b>Claude in Chrome</b><div className="sub">{t('Браузер для ботов')}</div></div><Toggle on={settings.claudeInChrome} onChange={(v) => setSettings({ claudeInChrome: v })} /></div>
      <h3>{t('Ограничители')}</h3>
      <NumRow label={t('Одновременных ботов')} sub={t('Остальные ждут в очереди')} value={settings.maxParallel} min={1} max={32} onCommit={(v) => setSettings({ maxParallel: v })} />
      <NumRow label={t('Пауза ботов при недельной квоте, %')} sub={t('0 = не останавливать')} value={settings.pauseAtPct} min={0} max={100} onCommit={(v) => setSettings({ pauseAtPct: v })} />
      <NumRow label={t('Пауза ботов при 5-часовой квоте, %')} sub={t('0 = не останавливать')} value={settings.pauseAtPct5h} min={0} max={100} onCommit={(v) => setSettings({ pauseAtPct5h: v })} />
      <NumRow label={t('Глубина цепочки «бот зовёт бота»')} sub={t('Сколько ботов подряд могут будить друг друга')} value={settings.maxChainDepth} min={1} max={50} onCommit={(v) => setSettings({ maxChainDepth: v })} />
      <h3>{t('Защита от петель между ботами')}</h3>
      <NumRow label={t('Передач на одну пару ботов')} sub={t('0 = без ограничения')} value={settings.handoffPair} min={0} max={500} onCommit={(v) => setSettings({ handoffPair: v })} />
      <NumRow label={t('Передач всего')} sub={t('0 = без ограничения')} value={settings.handoffTotal} min={0} max={2000} onCommit={(v) => setSettings({ handoffTotal: v })} />
      <NumRow label={t('Окно для этих лимитов, минут')} value={settings.handoffWindow} min={1} max={1440} onCommit={(v) => setSettings({ handoffWindow: v })} />
      <NumRow label={t('Пауза между /all от ботов, минут')} sub={t('0 = без ограничения')} value={settings.allCooldown} min={0} max={1440} onCommit={(v) => setSettings({ allCooldown: v })} />
    </Modal>
  )
}

function SearchModal() {
  const { messages, bots, channels, setModal, setActive } = useStore()
  const [q, setQ] = useState('')
  const res = q.trim() ? messages.filter((m) => m.text.toLowerCase().includes(q.toLowerCase())).slice(-20).reverse() : []
  return (
    <Modal title={t('Поиск')} onClose={() => setModal(null)}>
      <div className="search-box"><Search size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Поиск по всем сообщениям')} /></div>
      <div className="results">
        {res.map((m) => (
          <button key={m.id} onClick={() => { setActive(m.channelId); setModal(null) }}>
            <div className="sub">#{channels.find((c) => c.id === m.channelId)?.name} · {authorName(m.authorId, bots)}</div>
            {m.text}
          </button>
        ))}
        {q.trim() && res.length === 0 && <div className="sub">{t('Ничего не найдено')}</div>}
      </div>
    </Modal>
  )
}

export default function Modals() {
  const { modal, setModal } = useStore()
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setModal('search') }
      if (e.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setModal])
  if (modal === 'createBot') return <CreateBot />
  if (modal === 'createGroup') return <CreateGroup />
  if (modal === 'settings') return <SettingsModal />
  if (modal === 'search') return <SearchModal />
  if (modal === 'profile') return <ProfileModal />
  if (modal === 'accounts') return <AccountsModal />
  if (modal === 'account') return <AccountModal />
  if (modal === 'connections') return <Connections />
  if (modal === 'tools') return <Tools />
  return null
}

export function Lightbox() {
  const { lightbox, setLightbox } = useStore()
  if (!lightbox) return null
  const img = lightbox.mime.startsWith('image/')
  return (
    <div className="overlay light" onMouseDown={() => setLightbox(null)}>
      <div className="lb" onMouseDown={(e) => e.stopPropagation()}>
        {img ? <img src={lightbox.url} alt={lightbox.name} /> : <div className="lb-file">{lightbox.name}</div>}
        <div className="lb-bar"><b>{lightbox.name}</b><span>{fmtSize(lightbox.size)}</span><a className="btn" href={lightbox.url} download={lightbox.name}>{t('Скачать')}</a></div>
      </div>
    </div>
  )
}

// Просмотр файла из сообщения: текст с номерами строк, нужная строка подсвечена и показана
export function FileViewer() {
  const { fileView, closeFile, say } = useStore()
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => { target.current?.scrollIntoView({ block: 'center' }) }, [fileView])
  if (!fileView) return null
  const lines = fileView.text.split('\n')
  return (
    <div className="overlay" onMouseDown={closeFile}>
      <div className="modal wide fv" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="fv-title"><h2>{fileView.name}</h2><div className="sub rs-path">{fileView.path}{fileView.truncated ? ' · ' + t('показано начало файла') : ''}</div></div>
          <button className="btn small" onClick={() => { navigator.clipboard?.writeText(fileView.path); say(t('Скопировано')) }}>{t('Копировать путь')}</button>
          <button className="icon-btn" onClick={closeFile}><X size={18} /></button>
        </div>
        <div className="fv-body">
          {lines.map((l, i) => (
            <div key={i} className={'fv-line' + (i + 1 === fileView.line ? ' hit' : '')} ref={i + 1 === fileView.line ? target : undefined}>
              <span className="fv-n">{i + 1}</span><span className="fv-t">{l || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
