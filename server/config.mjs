import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { AppError } from './errors.mjs'

export const backendEnv = fileURLToPath(new URL('./.env', import.meta.url))
const legacyEnv = fileURLToPath(new URL('../.env', import.meta.url))

export function loadModelConfig() {
  for (const path of [backendEnv, legacyEnv]) {
    try { loadEnvFile(path) } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取本地 .env 配置。')
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  const legacyKey = process.env.LLM_API_KEY?.trim()
  const openaiUrl = 'https://api.openai.com/v1'
  const explicitBaseUrl = openaiKey ? process.env.OPENAI_BASE_URL?.trim() : process.env.LLM_BASE_URL?.trim()
  return {
    key: openaiKey || legacyKey,
    model: !openaiKey && legacyKey ? process.env.LLM_MODEL?.trim() : process.env.OPENAI_MODEL?.trim(),
    baseUrl: explicitBaseUrl || openaiUrl,
    explicitBaseUrl,
    timeout: Math.min(180000, Math.max(5000, Number(process.env.LLM_TIMEOUT_MS) || 90000)),
    tokenParam: process.env.LLM_TOKEN_PARAM === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    jsonMode: process.env.LLM_JSON_MODE !== 'false',
  }
}

export function modelApiUrl(base, path) {
  try {
    const url = new URL(base)
    if (url.username || url.password || url.search || url.hash) throw new Error()
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) throw new Error()
    url.pathname = url.pathname.replace(/\/+$/, '') + '/' + path
    return url
  } catch {
    throw new AppError(503, 'OPENAI_BASE_URL 或 LLM_BASE_URL 无效。远程模型地址需要使用 HTTPS。')
  }
}
