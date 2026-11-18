import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyMerge, createProject, openStore } from '../server/store.mjs'

function candidate(id, more = {}) {
  return { id, target_section: 'plan', target_item_id: null, operation: 'add', proposed_change: '保留证据',
    expected_text: null, status: 'pending', merged_version: null, ...more }
}

test('confirmation is persisted once under concurrency and rejection preserves Main', async (t) => {
  const parent = fileURLToPath(new URL('../data/', import.meta.url))
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'test-'))
  const file = join(directory, 'state.json')
  t.after(async () => { await rm(file, { force: true }); await rmdir(directory) })
  const store = await openStore(file)
  await store.update((state) => {
    createProject(state, { name: 'Example', goal: 'Preserve evidence' })
    state.runs.push({ candidates: [candidate('accept'), candidate('reject')] })
  })
  await Promise.all([
    store.update((state) => applyMerge(state, 'accept', 'confirmed')),
    store.update((state) => applyMerge(state, 'accept', 'confirmed')),
    store.update((state) => applyMerge(state, 'reject', 'rejected')),
  ])
  const state = (await openStore(file)).read()
  assert.equal(state.project.current_version, 2)
  assert.equal(state.versions.length, 2)
  assert.deepEqual(state.versions[0].plan, [])
  assert.equal(state.versions[1].plan[0].text, '保留证据')
  assert.deepEqual(state.versions[1].merged_candidate_ids, ['accept'])
  assert.deepEqual(state.runs[0].candidates.map((entry) => entry.status), ['confirmed', 'rejected'])
  await assert.rejects(store.update((draft) => applyMerge(draft, 'reject', 'confirmed')), { status: 409 })
})

test('replacement and closing a question preserve old snapshots and reject stale targets', () => {
  const state = { project: null, versions: [], runs: [] }
  createProject(state, { name: 'Example', goal: 'Example goal' })
  state.runs.push({ candidates: [candidate('add', { target_section: 'unresolved_questions' })] })
  applyMerge(state, 'add', 'confirmed')
  const [item] = state.versions.at(-1).unresolved_questions
  const target = { target_section: 'unresolved_questions', target_item_id: item.id, expected_text: item.text }
  state.runs[0].candidates.push(
    candidate('replace', { ...target, operation: 'replace', proposed_change: '验证证据质量' }),
    candidate('stale', { ...target, operation: 'resolve' }),
    candidate('close', { ...target, operation: 'resolve', expected_text: '验证证据质量' }),
  )
  applyMerge(state, 'replace', 'confirmed')
  assert.throws(() => applyMerge(state, 'stale', 'confirmed'), { status: 409 })
  applyMerge(state, 'close', 'confirmed')
  assert.deepEqual(state.versions.map((version) => version.unresolved_questions.map((entry) => entry.text)),
    [[], ['保留证据'], ['验证证据质量'], []])
  assert.equal(state.runs[0].candidates[2].status, 'pending')
})
