import express from 'express'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { analyze, createModel, judgeRelevance, prepareRelevance } from './analysis.mjs'
import { loadModelConfig } from './config.mjs'
import { AppError } from './errors.mjs'
import { mergeImported, parseExport } from './import.mjs'
import { loadLocalDemo } from './local-demo.mjs'
import { limits, recall } from './retrieval.mjs'
import { applyMerge, completeFollowup, createProject, openStore } from './store.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const model = createModel(loadModelConfig())
const port = Number(process.env.PORT ?? 4173)
const dev = process.argv.includes('--dev')
const store = await openStore(resolve(root, process.env.THOUGHT_RADAR_DATA || 'data/workspace.json'))
if (!process.env.THOUGHT_RADAR_DATA) await loadLocalDemo(store, root)

const app = express()
const server = createServer(app)
app.disable('x-powered-by')
app.use((req, res, next) => {
  const host = req.headers.host
  if (!host || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host)) return next(new AppError(403, '请使用本机地址访问工作台。'))
  if (req.headers.origin && req.headers.origin !== 'http://' + host) return next(new AppError(403, '请求来源无效。'))
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Referrer-Policy', 'no-referrer')
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store')
  next()
})

const json = express.json({ limit: '32kb' })
const id = z.string().min(1).max(500)
let modelBusy = false

function parse(schema, req) {
  const input = schema.safeParse(req.body)
  if (!input.success) throw new AppError(400, '提交内容无效，请检查输入。')
  return input.data
}

function getProject(state) {
  if (!state.project) throw new AppError(409, '请先设置项目名称和目标。')
  return state.project
}

async function modelCall(action) {
  if (!model.ready) throw new AppError(503, 'AI 分析不可用。请配置模型后端并重启，或继续查看已导入聊天。')
  if (modelBusy) throw new AppError(409, '模型正在处理另一个请求，请稍后重试。')
  modelBusy = true
  try { return await action() } finally { modelBusy = false }
}

function chatInfo(chat) {
  return {
    id: chat.id, title: chat.title, created_at: chat.created_at, updated_at: chat.updated_at,
    format: chat.format, message_count: chat.messages.length, path_count: chat.paths.length,
  }
}

app.get('/api/workspace', (_req, res) => {
  const { project, versions, runs, conversations } = store.read()
  res.json({ project, versions, runs, chats: conversations.map(chatInfo), model_ready: model.ready, limits })
})

app.post('/api/project', json, async (req, res) => {
  const fields = parse(z.object({ name: z.string().trim().min(1).max(80), goal: z.string().trim().min(1).max(1800) }), req)
  const project = await store.update((draft) => createProject(draft, fields))
  res.status(201).json(project)
})

app.post('/api/import', express.raw({ type: 'application/json', limit: limits.uploadMb + 'mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new AppError(400, '请上传 JSON 文件。')
  let payload
  try { payload = JSON.parse(req.body.toString('utf8').replace(/^\uFEFF/, '')) } catch {
    throw new AppError(400, '文件不是有效 JSON。请确认选中的是聊天导出文件。')
  }
  const result = parseExport(payload)
  if (!result.recognized) throw new AppError(422, '未找到支持的聊天格式。请上传 conversations.json 或包含 metadata 和 messages 的导出。')
  if (result.conversations.length) {
    await store.update((draft) => { draft.conversations = mergeImported(draft.conversations, result.conversations) })
  }
  res.json({ stats: result.stats })
})

app.get('/api/chats/:id', (req, res) => {
  const chat = store.read().conversations.find((entry) => entry.id === req.params.id)
  if (!chat) throw new AppError(404, '这段聊天没有在本地导入。')
  res.json(chat)
})

app.post('/api/evidence', json, (req, res) => {
  const { source_ids } = parse(z.object({ source_ids: z.array(id).min(1).max(12) }), req)
  const wanted = new Set(source_ids)
  const found = new Map()
  for (const chat of store.read().conversations) {
    for (const message of chat.messages) {
      if (wanted.has(message.source_id)) found.set(message.source_id, { ...message, title: chat.title, link: chat.link })
    }
  }
  if (found.size !== wanted.size) throw new AppError(404, '部分来源已无法在本地存档中找到。')
  res.json([...wanted].map((sourceId) => found.get(sourceId)))
})

app.get('/api/relevance', (_req, res) => {
  const state = store.read()
  const project = getProject(state)
  res.json(recall(state.conversations, project))
})

app.post('/api/relevance', async (_req, res) => {
  const state = store.read()
  const project = getProject(state)
  const prepared = prepareRelevance(state.conversations, project)
  const results = prepared.chats.length ? await modelCall(() => judgeRelevance(model, { name: project.name, goal: project.goal }, prepared)) : []
  res.json(results)
})

app.post('/api/analyze', json, async (req, res) => {
  const { conversation_ids } = parse(z.object({ conversation_ids: z.array(id).min(1).max(limits.selection) }), req)
  const state = store.read()
  const project = getProject(state)
  const byId = new Map(state.conversations.map((chat) => [chat.id, chat]))
  const selected = [...new Set(conversation_ids)].map((chatId) => byId.get(chatId))
  if (selected.some((chat) => !chat)) throw new AppError(400, '选择中包含尚未导入的聊天。')
  const run = await modelCall(() => analyze(model, project, state.versions.at(-1), selected))
  await store.update((draft) => { draft.runs.push(run) }, state.revision)
  res.status(201).json(run)
})

app.post('/api/merges/:id', json, async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['confirmed', 'rejected']) }), req)
  res.json(await store.update((draft) => applyMerge(draft, req.params.id, status)))
})

app.post('/api/followups/:id/complete', json, async (req, res) => {
  res.json(await store.update((draft) => completeFollowup(draft, req.params.id)))
})

app.use('/api', (_req, _res, next) => next(new AppError(404, '接口不存在。')))

let vite
if (dev) {
  const { createServer: createVite } = await import('vite')
  vite = await createVite({ configFile: resolve(root, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } } })
  app.use(vite.middlewares)
} else {
  const web = resolve(root, 'dist')
  app.use(express.static(web, { dotfiles: 'deny', index: 'index.html' }))
}

app.use((error, _req, res, _next) => {
  if (error instanceof AppError) return res.status(error.status).json({ error: error.message })
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '文件超过 ' + limits.uploadMb + ' MB 上传上限。' })
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '请求 JSON 格式不正确。' })
  // Never log the upstream response, exception payload, or request body.
  console.error('工作台请求失败。')
  res.status(500).json({ error: '工作台遇到错误，请重试。' })
})

const onStartupError = async (error) => {
  process.exitCode = 1
  if (error.code === 'EADDRINUSE') {
    console.error('端口 ' + port + ' 已被占用。如果 Thought Radar 已启动，请直接打开 http://127.0.0.1:' + port + '/。')
  } else {
    console.error('无法启动 Thought Radar（' + (error.code ?? '监听失败') + '）。')
  }
  await vite?.close()
}
server.once('error', onStartupError)
server.listen(port, '127.0.0.1', () => {
  server.off('error', onStartupError)
  console.log('Thought Radar · http://127.0.0.1:' + server.address().port)
})
