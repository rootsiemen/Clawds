export type Bot = {
  id: string
  name: string
  role: string
  color: string
  model: string // алиас или полное имя модели для claude --model
  effort: string // default, low, medium, high, xhigh, max
  boss: boolean // главный: может менять размышления других ботов
  claudeMd: string
  memory: string
  todo: string
  schedule: { id: string; cron: string; prompt: string }[]
  runsToday: number
  costToday?: number
  sleeping: boolean
  mcp: string[] // включённые сторонние MCP-серверы
  skills: string[] // включённые навыки
}

export type ToolCall = {
  id: string
  tool: string
  input: string
  output?: string
  done: boolean
}

export type Attachment = { id: string; name: string; size: number; mime: string; url: string; path?: string }

export type FileRef = { kind: 'text' | 'image' | 'binary'; size: number }

export type Message = {
  refs?: Record<string, FileRef> // пути из `кавычек`, которые указывают на существующие файлы
  id: string
  channelId: string
  authorId: string // 'me', id бота или 'system'
  text: string
  ts: number
  threadOf?: string
  tools?: ToolCall[]
  reactions: Record<string, string[]> // реакция -> кто поставил
  pinned?: boolean
  streaming?: boolean
  attachments?: Attachment[]
  error?: boolean
  system?: boolean
  tier?: 1 // важное для всех: /all или закреплённое сообщение группы
  notify?: Record<string, number> // кому и с каким приоритетом (2 будит, 3 только уведомление)
}

export type Channel = {
  id: string
  kind: 'channel' | 'dm'
  name: string
  members: string[] // 'me' и id ботов
}

export type FileNode = { name: string; type: 'file' | 'dir'; children?: FileNode[] }

export type Commit = { hash: string; msg: string; author: string; ago: string; branch: string }

export type Workspace = {
  path: string
  remote: string
  branches: string[]
  commits: Commit[]
  tree: FileNode[]
  folders: string[]
  dirty: number
}

export type Quota = {
  known: boolean
  fiveHour: { pct: number; resetsAt: number }
  sevenDay: { pct: number; resetsAt: number }
}

export type Settings = {
  fullAccess: boolean
  computerUse: boolean
  claudeInChrome: boolean
  maxParallel: number
  pauseAtPct: number
  pauseAtPct5h: number
  maxChainDepth: number
  handoffPair: number // передач на пару ботов за окно, 0 = без ограничения
  handoffTotal: number
  handoffWindow: number // минут
  allCooldown: number // минут между /all от бота, 0 = без ограничения
}

export type Account = {
  id: string
  name: string
  username: string
  number: string // +888 XXXX XXXX, выдаётся автоматически
  primary: 'username' | 'number'
  bio: string
  blocked: string[]
  muted: string[]
  log: { ts: number; text: string }[]
}

export type RecentSession = {
  id: string
  name: string
  folder: string
  created: number
  opened: number
  bots: number
  exists: boolean
  current: boolean
}
export type Session = { id: string; name: string; folder: string }

// Свои эндпоинты (OpenRouter, LM Studio и т.п.): ключ с сервера не приходит, только последние символы
export type ProviderModel = { id: string; name: string; lite: boolean; manual?: boolean }
export type Provider = {
  id: string; name: string; baseUrl: string; auth: 'bearer' | 'x-api-key'; liteDefault: boolean
  keyTail: string; hasKey: boolean; fetchedAt: number; error: string; models: ProviderModel[]
}
export type Conn = { loggedIn: boolean; pending: boolean; providers: Provider[] }

// Сторонние MCP-серверы и навыки (значения ключей с сервера не приходят)
export type McpServer = { id: string; name: string; type: 'stdio' | 'http' | 'sse'; command: string; args: string[]; url: string; envKeys: string[]; headerKeys: string[]; source: string; allBots: boolean }
export type SkillInfo = { name: string; description: string; size: number; builtin: boolean; source: string }
