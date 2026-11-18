import { loadModelConfig, modelApiUrl } from './config.mjs'
import { AppError } from './errors.mjs'

try {
  const config = loadModelConfig()
  const list = process.argv.includes('--list')
  if (!config.key) {
    throw new AppError(503, '请先在 server/.env 填写 OPENAI_API_KEY。')
  }
  if (!list && !config.model) {
    throw new AppError(503, '请先在 server/.env 填写 OPENAI_MODEL。')
  }
  if (list && !config.explicitBaseUrl) {
    throw new AppError(503, '请先在 server/.env 填写主办方给出的 OPENAI_BASE_URL。')
  }
  const url = modelApiUrl(config.baseUrl, list ? 'models' : 'models/' + encodeURIComponent(config.model))
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + config.key },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    const reason = { 401: '请核对 API Key。', 403: '请检查密钥的模型读取权限。',
      404: '请检查模型名称、模型权限和 API 地址。', 429: '请检查模型服务的频率或额度限制。' }
    const unsupported = list && [404, 405, 501].includes(response.status)
    throw new AppError(502, '模型查询返回 HTTP ' + response.status + '。' + (unsupported
      ? '请核对主办方的 Base URL，并索取可用模型 ID 或模型列表接口。'
      : reason[response.status] ?? '请检查模型服务状态。'))
  }
  const model = await response.json().catch(() => null)
  if (list && Array.isArray(model?.data)) {
    const ids = [...new Set(model.data.map((item) => item?.id)
      .filter((id) => typeof id === 'string' && /^[!-~]+$/.test(id) && !id.includes(config.key)))].sort()
    if (!ids.length) throw new AppError(502, '模型列表未返回可用 ID，请向主办方核对密钥权限和模型清单。')
    for (const id of ids) console.log(id)
  } else if (list || model?.object !== 'model' || typeof model.id !== 'string') {
    throw new AppError(502, '模型服务响应无法识别，请确认 API 地址支持模型查询。')
  } else {
    console.log('API 连接成功，已读取所配置模型的信息。')
  }
} catch (error) {
  console.error(error instanceof AppError ? error.message :
    error.name === 'TimeoutError' ? '模型查询超时，请检查网络。' : '无法读取配置或连接模型 API，请检查本地配置和网络。')
  process.exitCode = 1
}
