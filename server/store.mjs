import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from './errors.mjs'

const empty = { revision: 0, project: null, conversations: [], runs: [], versions: [] }

export async function openStore(file) {
  let state
  try {
    state = JSON.parse(await readFile(file, 'utf8'))
    if (typeof state.revision !== 'number' || !Array.isArray(state.conversations)
        || !Array.isArray(state.runs) || !Array.isArray(state.versions)) throw new Error()
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取工作台存档。请检查本地 JSON 文件。')
    state = structuredClone(empty)
  }
  let pending = Promise.resolve()
  return {
    read: () => state,
    update(change, expectedRevision) {
      const update = pending.then(async () => {
        if (expectedRevision !== undefined && state.revision !== expectedRevision) {
          throw new AppError(409, '工作台在分析期间已更新，请重新运行分析。')
        }
        const draft = structuredClone(state)
        const result = change(draft)
        draft.revision++
        await mkdir(dirname(file), { recursive: true })
        const temp = file + '.' + randomUUID() + '.tmp'
        try {
          await writeFile(temp, JSON.stringify(draft), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
          await rename(temp, file)
        } catch {
          await rm(temp, { force: true }).catch(() => {})
          throw new AppError(500, '无法写入工作台存档。请检查本地路径和磁盘空间。')
        }
        state = draft
        return result
      })
      pending = update.catch(() => {})
      return update
    },
  }
}

export function createProject(state, { name, goal }) {
  if (state.project) throw new AppError(409, '当前工作台已有项目。')
  const project = { id: randomUUID(), name, goal, current_version: 1 }
  state.project = project
  state.versions.push({
    id: randomUUID(), version_number: 1, project_goal: goal,
    plan: [], confirmed_decisions: [], unresolved_questions: [],
    merged_candidate_ids: [], created_at: new Date().toISOString(),
  })
  return project
}

export function completeFollowup(state, id) {
  const item = state.runs.flatMap((run) => run.followups ?? []).find((entry) => entry.id === id)
  if (!item) throw new AppError(404, '待办事项不存在。')
  item.status = 'done'
  return item
}

export function applyMerge(state, candidateId, status) {
  const candidate = state.runs.flatMap((run) => run.candidates).find((entry) => entry.id === candidateId)
  if (!candidate || !state.project) throw new AppError(404, '合并候选不存在。')
  if (candidate.status === status) return candidate
  if (candidate.status !== 'pending') throw new AppError(409, '该候选已经处理。')
  if (status === 'rejected') {
    candidate.status = status
    candidate.reviewed_at = new Date().toISOString()
    return candidate
  }

  const current = state.versions.at(-1)
  const next = {
    ...structuredClone(current), id: randomUUID(), version_number: current.version_number + 1,
    created_at: new Date().toISOString(), merged_candidate_ids: [candidate.id],
  }
  const items = next[candidate.target_section]
  const target = items.findIndex((item) => item.id === candidate.target_item_id)
  if (candidate.operation !== 'add' && (target < 0 || items[target].text !== candidate.expected_text)) {
    throw new AppError(409, '这条提案的目标已经变更。请重新分析或拒绝旧草稿。')
  }
  if (candidate.operation !== 'resolve') {
    const normalized = (value) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
    if (items.some((item) => normalized(item.text) === normalized(candidate.proposed_change))) {
      throw new AppError(409, '相同内容已存在于当前 Main，请处理重复草稿。')
    }
  }
  if (candidate.operation === 'add') items.push({ id: randomUUID(), text: candidate.proposed_change })
  else if (candidate.operation === 'replace') items[target] = { ...items[target], text: candidate.proposed_change }
  else items.splice(target, 1)
  candidate.status = 'confirmed'
  candidate.merged_version = next.version_number
  candidate.reviewed_at = next.created_at
  state.versions.push(next)
  state.project.current_version = next.version_number
  return candidate
}
