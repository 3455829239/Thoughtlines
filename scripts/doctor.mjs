import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { backendEnv, loadModelConfig } from '../server/config.mjs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const hasEnv = existsSync(backendEnv)
console.log('项目目录  ' + fileURLToPath(root))
const [major, minor] = process.versions.node.split('.').map(Number)
const supported = major > 22 || (major === 22 && minor >= 12)
console.log('Node      ' + process.version + (supported ? ' · 就绪' : ' · 需要 Node.js 22.12 或以上'))

const hasLock = existsSync(new URL('package-lock.json', root))
console.log('锁文件    ' + (hasLock ? '存在' : '缺少 package-lock.json'))
const dependencies = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]
const missing = dependencies.filter((name) => !existsSync(new URL('node_modules/' + name + '/package.json', root)))
console.log('依赖      ' + (missing.length ? '缺少 ' + missing.join(', ') : '就绪'))
if (!supported || !hasLock || missing.length) process.exitCode = 1
if (missing.length) console.log('安装命令  ' + (hasLock ? 'npm ci' : 'npm install'))

let model
try {
  const config = loadModelConfig()
  model = config.key && config.model
} catch {
  console.log('配置      无法读取 .env，请检查文件权限和格式。')
  process.exit(1)
}
console.log('AI 配置   ' + (model ? '已设置密钥和模型' : '本地模式，可导入、检索和查看聊天')
  + (hasEnv ? '' : ' · 无 .env'))

const port = Number(process.env.PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.log('端口      PORT 应设置为 1 到 65535 的整数，便于诊断固定地址。')
  process.exit(1)
}
const url = 'http://127.0.0.1:' + port + '/'
console.log('工作台    ' + url)

async function probe(path, format) {
  const response = await fetch(new URL(path, url), { redirect: 'manual', signal: AbortSignal.timeout(3000) })
  return { status: response.status, data: response.ok ? await response[format]().catch(() => null) : null }
}

const [home, api] = await Promise.allSettled([probe('/', 'text'), probe('/api/workspace', 'json')])
const isHome = home.value?.data?.includes('<title>Thought Radar')
const scope = api.value?.data
const isApi = typeof scope?.model_ready === 'boolean' && Array.isArray(scope.chats) && Array.isArray(scope.versions)
if (isHome && isApi) {
  console.log('结果      Thought Radar 已运行。直接打开工作台，无需再次启动。')
  console.log('运行状态  ' + (scope.model_ready ? '模型已配置' : '本地模式'))
} else if ([home, api].every((probe) => probe.reason?.cause?.code === 'ECONNREFUSED')) {
  console.log('结果      当前没有可连接的服务。' + (process.exitCode ? '请先处理上方检查项。' : '现在可以运行 npm run dev。'))
} else {
  process.exitCode = 1
  const detail = (probe) => probe.value ? 'HTTP ' + probe.value.status
    : probe.reason?.cause?.code ?? probe.reason?.name ?? '未知错误'
  console.log('诊断      首页 ' + detail(home) + ' · API ' + detail(api))
  if (isHome || isApi) console.log('结果      Thought Radar 部分可访问，请检查启动终端中的报错。')
  else if (home.value || api.value) console.log('结果      该端口返回的响应无法识别为 Thought Radar。请检查端口占用。')
  else console.log('结果      无法验证服务，请先在本机 PowerShell 重试，或检查端口监听状态。')
}
