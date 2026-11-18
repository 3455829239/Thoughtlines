import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, judgeRelevance, prepareRelevance } from '../server/analysis.mjs'
import { parseExport } from '../server/import.mjs'
import { bundle, limits } from '../server/retrieval.mjs'

const project = { id: 'project', name: '信息整理', goal: '整理聊天并保留原始讨论来源' }
const chats = parseExport([
  { metadata: { title: '聊天整理' }, messages: [{ role: 'Prompt', say: '验证聊天整理和来源。'.repeat(800) }] },
  { metadata: { title: '烹调' }, messages: [{ role: 'Prompt', say: '在平底锅煎鸡蛋。' }] },
]).conversations
const main = { version_number: 1, plan: [], confirmed_decisions: [], unresolved_questions: [] }
const s1 = chats[0].messages[0].source_id
const s2 = chats[1].messages[0].source_id

function output(sourceId = s1) {
  return {
    branches: [{ key: 'b1', question: '如何保留聊天来源？', status: 'open', commits: [
      { key: 'c1', type: 'exploration', title: '验证来源', summary: '验证保留来源的方案。',
        reason: '讨论明确提出验证需求。', confidence: 0.75, source_ids: [sourceId] },
    ] }],
    candidates: [{ branch_key: 'b1', commit_keys: ['c1'], source_ids: [sourceId], operation: 'add',
      proposed_change: '为整理结果保留来源。', target_section: 'plan', target_item_id: null, reason: '可回溯讨论。' }],
    questions: [{ key: 'q1', branch_key: 'b1', question: '来源能否回查？', source_ids: [sourceId],
      depends_on: [], blocking: true, quick_check: true, next_action: '验证来源能否打开', reason: '验证追溯性。' }],
  }
}

test('local recall and excerpts limit the data available to the model', async () => {
  const prepared = prepareRelevance(chats, project)
  assert.deepEqual(prepared.local.map((row) => row.conversation_id), [chats[0].id])
  assert.ok(prepared.chats[0].messages[0].text.length <= limits.relevanceCharsPerChat)
  assert.ok(bundle([chats[0]], project, 'analysis')[0].messages[0].text.length <= limits.analysisCharsPerChat)
  const relevance = (sourceId) => ({ ask: async () => ({
    chats: [{ conversation_id: chats[0].id, relevant: true, reason: '讨论符合目标。', source_ids: [sourceId] }],
  }) })
  assert.equal((await judgeRelevance(relevance(s1), project, prepared))[0].relevant, true)
  await assert.rejects(judgeRelevance(relevance(s2), project, prepared), { status: 502 })
})

test('validated analysis links sourced commits, proposals and the next action', async () => {
  const result = await analyze({ ask: async (_system, input) => {
    assert.deepEqual(input.chats.map((chat) => chat.conversation_id), [chats[0].id])
    return output()
  } }, project, main, [chats[0]])
  assert.equal(result.branches[0].commit_ids[0], result.commits[0].id)
  assert.equal(result.candidates[0].status, 'pending')
  assert.equal(result.candidates[0].source_ids[0], s1)
  assert.equal(result.recommendation.question_id, result.questions[0].id)
  assert.equal(result.commits[0].timestamp, null)
})

test('a sourced return to Main links a branch commit without confirming a merge', async () => {
  const payload = output()
  payload.main_events = [{ title: '收敛比赛范围', summary: '聚焦当前比赛项目。', reason: '用户明确说明当前范围。',
    source_ids: [s1], after: [{ branch_key: 'b1', commit_key: 'c1' }] }]
  const result = await analyze({ ask: async () => payload }, project, main, [chats[0]])
  assert.deepEqual(result.main_events[0].from_commit_ids, [result.commits[0].id])
  assert.deepEqual(result.main_events[0].source_ids, [s1])
  assert.equal(result.candidates[0].status, 'pending')
  assert.equal(main.version_number, 1)
  payload.main_events[0].after[0].commit_key = 'missing'
  await assert.rejects(analyze({ ask: async () => payload }, project, main, [chats[0]]), { status: 502 })
})

test('a branch theme is backed by sources on that branch', async () => {
  const payload = output()
  payload.branches[0].theme = { label: '证据追溯', summary: '讨论如何保留聊天来源。', keywords: ['来源'], source_ids: [s1] }
  const result = await analyze({ ask: async () => payload }, project, main, chats)
  assert.deepEqual(result.branches[0].theme, payload.branches[0].theme)
  payload.branches[0].theme.source_ids = [s2]
  await assert.rejects(analyze({ ask: async () => payload }, project, main, chats), { status: 502 })
})

test('before evidence must precede the change, and followups can exist without questions', async () => {
  const [chat] = parseExport({ metadata: { title: '范围变化' }, messages: [
    { role: 'Prompt', say: '先尝试整理所有聊天。' },
    { role: 'Prompt', say: '这次只整理当前项目的对话。' },
  ] }).conversations
  const [before, after] = chat.messages.map((item) => item.source_id)
  const response = output(after)
  const node = response.branches[0].commits[0]
  node.prior = { text: '整理所有聊天。', source_ids: [before] }
  response.questions = []
  response.followups = [{ kind: 'verification', title: '试读一次分支图', reason: '检查能否理解收敛过程。',
    priority: true, source_ids: [after] }]
  const result = await analyze({ ask: async () => response }, project, main, [chat])
  assert.deepEqual(result.commits[0].prior, node.prior)
  assert.equal(result.followups[0].status, 'pending')
  assert.equal(result.questions.length, 0)
  node.prior.source_ids = [after]
  const unsupported = await analyze({ ask: async () => response }, project, main, [chat])
  assert.equal(unsupported.commits[0].prior, undefined)
})

test('analysis rejects nonexistent and out-of-scope evidence, mismatched commits and cyclic dependencies', async () => {
  for (const bad of [output('nonexistent'), output(s2)]) {
    await assert.rejects(analyze({ ask: async () => bad }, project, main, [chats[0]]), { status: 502 })
  }
  const badCandidate = output()
  badCandidate.candidates[0].commit_keys = ['c2']
  await assert.rejects(analyze({ ask: async () => badCandidate }, project, main, [chats[0]]), { status: 502 })
  const badQuestion = output()
  badQuestion.questions[0].depends_on = ['q1']
  await assert.rejects(analyze({ ask: async () => badQuestion }, project, main, [chats[0]]), { status: 502 })
})
