export const limits = {
  candidates: 12, selection: 8, relevanceCharsPerChat: 1000, analysisCharsPerChat: 5500,
  uploadMb: 100, callsPerAction: 1,
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const stop = new Set('的 了 和 与 对 不 是 就 到 将 为 在 及 日 我 你 这 那 很 一个 如何 是否 继续 通过 需要 进行 当前 项目 目标 讨论 方案 user the and with how will for what about this that into project'.split(' '))
const related = [
  ['整理', '归档', '沉淀', '总结', '梳理', '知识库', '归纳', '结构化', 'synthesis'],
  ['分支', '探索', '备选', '假设', '路径', 'branch', 'exploration'],
  ['决策', '取舍', '选择', '确认', '定案', 'decision'],
  ['验证', '实验', '测量', '测试', '评估', '证据', 'evidence', 'experiment'],
  ['检索', '召回', '查询', '搜索', 'retrieval', 'search'],
  ['上线', '发布', '部署', '交付', 'launch', 'deploy'],
  ['主线', '合并', '版本', '更新', 'merge', 'version'],
  ['风险', '障碍', '阻塞', '约束', '依赖', 'risk', 'blocker'],
  ['聊天', '对话', '会话', '消息', '记录', 'chat', 'conversation'],
]

function tokens(text) {
  return new Set([...segmenter.segment(text.toLowerCase())]
    .filter(({ segment, isWordLike }) => isWordLike && !stop.has(segment) && !/^\d+$/.test(segment))
    .map(({ segment }) => segment))
}

function termsFor(name, goal) {
  const terms = new Map([...tokens(goal)].map((term) => [term, 1]))
  for (const term of tokens(name)) terms.set(term, 2)
  for (const group of related) {
    if (group.some((term) => terms.has(term) && terms.get(term) >= 1)) {
      for (const term of group) if (!terms.has(term)) terms.set(term, 0.45)
    }
  }
  return [...terms.entries()].slice(0, 100)
}

const latin = /^[a-z0-9_-]+$/

function mentions(text, term) {
  if (!latin.test(term)) return text.includes(term)
  const pattern = new RegExp('(?:^|[^a-z0-9_-])' + term + '(?=$|[^a-z0-9_-])')
  return pattern.test(text)
}

export function recall(conversations, project) {
  const terms = termsFor(project.name, project.goal)
  const rows = conversations.map((chat) => {
    const title = chat.title.toLowerCase()
    const messages = chat.messages.map((message) => ({ ...message, text: message.text.toLowerCase() }))
    const matches = terms.flatMap(([term, weight]) => {
      const titleMatch = mentions(title, term)
      const occurrences = messages.filter((message) => mentions(message.text, term)).length
      return titleMatch || occurrences ? [{ term, points: weight * (Number(titleMatch) * 4 + Math.min(occurrences, 6)) }] : []
    })
    return { chat, matches }
  })
  const frequency = new Map()
  for (const row of rows) for (const { term } of row.matches) frequency.set(term, (frequency.get(term) ?? 0) + 1)
  return rows.map(({ chat, matches }) => ({
    conversation_id: chat.id,
    score: matches.reduce((sum, match) => sum + match.points * (1 + Math.log((rows.length + 1) / (frequency.get(match.term) + 1))), 0),
    terms: matches.sort((a, b) => b.points - a.points).slice(0, 7).map((match) => match.term),
  })).filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.conversation_id.localeCompare(b.conversation_id))
    .slice(0, limits.candidates)
}

function excerpt(text, budget, terms) {
  if (text.length <= budget) return text
  const lower = text.toLowerCase()
  const match = terms.map(([term, weight]) => ({ index: lower.indexOf(term), weight }))
    .filter(({ index }) => index >= 0).sort((a, b) => b.weight - a.weight || a.index - b.index)[0]
  const start = match ? Math.max(0, match.index - Math.floor(budget / 4)) : 0
  const tailLength = Math.floor(budget / 5)
  if (start + budget >= text.length) return '…' + text.slice(-(budget - 1))
  return (start ? '…' : '') + text.slice(start, start + budget - tailLength - 2)
    + '\n…' + text.slice(-tailLength)
}

export function bundle(chats, project, phase) {
  const terms = termsFor(project.name, project.goal)
  const budget = phase === 'relevance' ? limits.relevanceCharsPerChat : limits.analysisCharsPerChat
  return chats.map((chat) => {
    const byId = new Map(chat.messages.map((message) => [message.source_id, message]))
    const active = chat.paths[0].source_ids
    const activeIds = new Set(active)
    const alternate = [...new Set(chat.paths.slice(1).flatMap((path) => path.source_ids))]
      .filter((id) => !activeIds.has(id))
    const all = [...active, ...alternate].map((id, index) => ({ ...byId.get(id), index, alternate: !activeIds.has(id) }))
    const count = phase === 'relevance' ? 5 : 22
    const slots = all.map((message) => ({
      ...message,
      score: terms.reduce((sum, [term, weight]) => sum + (mentions(message.text.toLowerCase(), term) ? weight : 0), 0)
        + (message.role === 'user' ? 2 : 0),
    }))
    const anchors = new Set([0, Math.floor((active.length - 1) / 2), active.length - 1])
    if (alternate.length && phase === 'analysis') anchors.add(all.length - 1)
    const selected = slots.sort((a, b) => Number(anchors.has(b.index)) - Number(anchors.has(a.index))
      || b.score - a.score || b.index - a.index).slice(0, count).sort((a, b) => a.index - b.index)
    const share = Math.floor(budget / selected.length)
    return {
      conversation_id: chat.id, title: chat.title.slice(0, 200),
      messages: selected.map(({ source_id, role, text, alternate }) => ({
        source_id, role, text: excerpt(text, share, terms), path: alternate ? 'alternate' : 'current',
      })),
    }
  })
}
