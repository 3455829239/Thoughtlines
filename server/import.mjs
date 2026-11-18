import { createHash } from 'node:crypto'

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24)
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value) => typeof value === 'string' && value.trim() ? value : null

function isoTime(value) {
  const millis = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1)
    : typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
      ? Date.parse(value) : NaN
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? new Date(millis).toISOString() : null
}

function chatLink(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\/([\w-]+)(?:[?#].*)?$/)
  return match ? { id: match[1], url: 'https://chatgpt.com/c/' + match[1] } : null
}

function counters() {
  return {
    conversations: 0, invalid_conversation: 0, messages: 0, alternate_paths: 0,
    empty_message: 0, non_text_message: 0, non_text_part: 0, unsupported_role: 0,
    hidden_message: 0, missing_message: 0, missing_message_id: 0, invalid_path: 0,
    empty_conversation: 0,
  }
}

function source(conversationId, id, role, text, timestamp, derived = false) {
  return {
    source_id: encodeURIComponent(conversationId) + ':' + encodeURIComponent(id),
    conversation_id: conversationId, message_id: id, role, text, timestamp,
    message_id_is_local: derived,
  }
}

function officialText(message, stats) {
  if (!record(message)) { stats.missing_message++; return null }
  const role = message.author?.role
  if (role !== 'user' && role !== 'assistant') { stats.unsupported_role++; return null }
  if (message.metadata?.is_visually_hidden_from_conversation || message.channel === 'analysis'
      || (message.recipient && message.recipient !== 'all')) {
    stats.hidden_message++
    return null
  }
  const content = message.content
  if (!record(content) || !['text', 'multimodal_text', 'code', undefined].includes(content.content_type)) {
    stats.non_text_message++
    return null
  }
  const parts = Array.isArray(content.parts) ? content.parts
    : typeof content.text === 'string' ? [content.text] : []
  const visible = []
  let skipped = 0
  for (const part of parts) {
    if (typeof part === 'string') visible.push(part)
    else if (part?.content_type === 'text' && typeof part.text === 'string') visible.push(part.text)
    else skipped++
  }
  stats.non_text_part += skipped
  const text = visible.join('\n').trim()
  if (!text) {
    if (skipped) stats.non_text_message++
    else stats.empty_message++
    return null
  }
  return { role, text }
}

function recoverPaths(nodes, messages, currentNode, stats) {
  const hintedParents = new Map()
  for (const [id, node] of nodes) {
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (nodes.has(child) && !hintedParents.has(child)) hintedParents.set(child, id)
    }
  }
  const parents = new Map()
  const nonLeaves = new Set()
  for (const [id, node] of nodes) {
    const parent = node.parent === undefined ? hintedParents.get(id) : node.parent
    parents.set(id, parent ?? null)
    if (nodes.has(parent)) nonLeaves.add(parent)
  }
  const endpoints = [...nodes.keys()].filter((id) => !nonLeaves.has(id) && id !== currentNode)
  endpoints.sort((a, b) => {
    const time = (id) => isoTime(nodes.get(id)?.message?.create_time) ?? ''
    return time(b).localeCompare(time(a)) || a.localeCompare(b)
  })
  if (nodes.has(currentNode)) endpoints.unshift(currentNode)
  else if (currentNode != null) stats.invalid_path++
  const paths = []
  const signatures = new Set()
  const reached = new Set()
  for (const endpoint of endpoints) {
    const steps = new Set()
    const ids = []
    let id = endpoint
    while (id !== null && nodes.has(id) && !steps.has(id)) {
      steps.add(id)
      reached.add(id)
      if (messages.has(id)) ids.push(messages.get(id).source_id)
      id = parents.get(id)
    }
    if (id !== null) {
      stats.invalid_path++
      // Preserve a valid prefix after a missing parent. Cycles have no reliable order.
      if (steps.has(id)) continue
    }
    const sequence = ids.reverse()
    const signature = hash(JSON.stringify(sequence))
    if (!sequence.length || signatures.has(signature)) continue
    signatures.add(signature)
    paths.push({ id: signature, kind: paths.length ? 'alternate' : 'current', source_ids: sequence })
  }
  if (reached.size < nodes.size) stats.invalid_path++
  stats.alternate_paths += Math.max(0, paths.length - 1)
  return paths
}

function parseOfficial(row, stats) {
  const id = identifier(row.id) ?? identifier(row.conversation_id)
  if (!id) { stats.invalid_conversation++; return null }
  const nodes = new Map(Object.entries(row.mapping).filter(([, node]) => record(node)))
  const byNode = new Map()
  for (const [nodeId, node] of nodes) {
    const value = officialText(node.message, stats)
    if (!value) continue
    const messageId = identifier(node.message.id)
    const derivedId = 'local-' + hash(JSON.stringify([nodeId, value.role, value.text]))
    if (!messageId) stats.missing_message_id++
    byNode.set(nodeId, source(id, messageId ?? derivedId, value.role, value.text,
      isoTime(node.message.create_time), !messageId))
  }
  const paths = recoverPaths(nodes, byNode, row.current_node, stats)
  const used = new Set(paths.flatMap((path) => path.source_ids))
  const messages = new Map([...byNode.values()].filter((m) => used.has(m.source_id)).map((m) => [m.source_id, m]))
  return { id, title: identifier(row.title) ?? '未命名对话', created_at: isoTime(row.create_time),
    updated_at: isoTime(row.update_time), link: null, format: 'official', paths, messages: [...messages.values()] }
}

function parseLinear(row, stats) {
  const link = chatLink(row.metadata.link)
  const title = identifier(row.metadata.title) ?? '未命名对话'
  const id = link?.id ?? 'local-chat-' + hash(JSON.stringify([title, row.messages]))
  const messages = []
  for (const [index, message] of row.messages.entries()) {
    const role = message?.role === 'Prompt' ? 'user' : message?.role === 'Response' ? 'assistant' : null
    if (!role) { stats.unsupported_role++; continue }
    if (typeof message.say !== 'string') { stats.non_text_message++; continue }
    const text = message.say.trim()
    if (!text) { stats.empty_message++; continue }
    const localId = 'local-' + hash(JSON.stringify([index, role, text]))
    stats.missing_message_id++
    messages.push(source(id, localId, role, text, null, true))
  }
  const sourceIds = messages.map((m) => m.source_id)
  const paths = sourceIds.length
    ? [{ id: hash(JSON.stringify(sourceIds)), kind: 'current', source_ids: sourceIds }] : []
  return { id, title, created_at: isoTime(row.metadata.dates?.created),
    updated_at: isoTime(row.metadata.dates?.updated), link: link?.url ?? null,
    format: 'linear', paths, messages }
}

export function parseExport(input) {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.conversations) ? input.conversations : [input]
  const stats = counters()
  const conversations = []
  let recognized = 0
  for (const row of rows) {
    let parsed
    if (record(row?.mapping)) {
      recognized++
      parsed = parseOfficial(row, stats)
    } else if (record(row?.metadata) && Array.isArray(row.messages)) {
      recognized++
      parsed = parseLinear(row, stats)
    } else {
      stats.invalid_conversation++
    }
    if (!parsed) continue
    if (!parsed.messages.length) { stats.empty_conversation++; continue }
    stats.messages += parsed.messages.length
    stats.conversations++
    conversations.push(parsed)
  }
  return { recognized, conversations, stats }
}

export function mergeImported(existing, incoming) {
  const chats = new Map(existing.map((chat) => [chat.id, chat]))
  for (const next of incoming) {
    const previous = chats.get(next.id)
    if (!previous) { chats.set(next.id, next); continue }
    if (previous.format !== next.format) {
      const official = next.format === 'official' ? next : previous
      const linear = next.format === 'linear' ? next : previous
      // Preserve previously cited linear IDs. Official paths win during retrieval.
      chats.set(next.id, combineSnapshots({ ...official, link: linear.link ?? official.link }, linear))
      continue
    }
    const newest = previous.updated_at && next.updated_at && previous.updated_at > next.updated_at ? previous : next
    chats.set(next.id, combineSnapshots(newest, newest === previous ? next : previous))
  }
  return [...chats.values()]
}

function combineSnapshots(current, older) {
  const messages = new Map(older.messages.map((m) => [m.source_id, m]))
  for (const message of current.messages) messages.set(message.source_id, message)
  const knownPaths = new Set(current.paths.map((path) => path.id))
  const paths = [...current.paths, ...older.paths.filter((path) => !knownPaths.has(path.id))
    .map((path) => ({ ...path, kind: 'alternate' }))]
  return { ...current, messages: [...messages.values()], paths }
}
