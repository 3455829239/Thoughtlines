import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { mergeImported, parseExport } from '../server/import.mjs'

test('official mapping keeps the active path and regenerated answer, with shared evidence once', () => {
  const message = (role, parts, extra = {}) => ({
    id: extra.id, author: { role }, content: { content_type: 'multimodal_text', parts },
    create_time: 1700000000, ...extra,
  })
  const parsed = parseExport([{ id: 'chat-1', title: 'Example', current_node: 'regen', mapping: {
    root: { parent: null, message: null, children: ['system'] },
    system: { parent: 'root', message: message('system', ['system']), children: ['ask'] },
    ask: { parent: 'system', message: message('user', ['Question', { content_type: 'image_asset_pointer' }], { id: 'user-1' }) },
    original: { parent: 'ask', message: message('assistant', ['First answer'], { id: 'a1' }) },
    regen: { parent: 'ask', message: message('assistant', ['Regenerated answer'], { id: 'a2' }), children: ['empty'] },
    empty: { message: message('assistant', ['  ']) },
    tool: { parent: 'original', message: message('assistant', ['internal'], { recipient: 'browser' }) },
  } }])
  const [chat] = parsed.conversations
  assert.deepEqual(chat.paths.map((path) => path.source_ids), [
    ['chat-1:user-1', 'chat-1:a2'], ['chat-1:user-1', 'chat-1:a1'],
  ])
  assert.equal(chat.messages.length, 3)
  assert.equal(chat.messages[0].timestamp, '2023-11-14T22:13:20.000Z')
  assert.equal(parsed.stats.non_text_part, 1)
  assert.equal(parsed.stats.empty_message, 1)
  assert.equal(parsed.stats.hidden_message, 1)
  assert.equal(parsed.stats.alternate_paths, 1)
})

test('invalid formats and cycles do not invent conversation paths', () => {
  const parsed = parseExport({ conversations: [
    { title: 'Unsupported' },
    { id: 'cycle', current_node: 'a', mapping: { a: { parent: 'a' } } },
  ] })
  assert.equal(parsed.recognized, 1)
  assert.equal(parsed.conversations.length, 0)
  assert.equal(parsed.stats.invalid_conversation, 1)
  assert.equal(parsed.stats.invalid_path, 1)
})

test('local real exports parse with stable IDs and no invented message timestamps', async (t) => {
  const root = new URL('../', import.meta.url)
  const files = (await readdir(root)).filter((file) => /^ChatGPT-.*\.json$/u.test(file))
  let tested = 0
  for (const file of files) {
    const input = JSON.parse((await readFile(new URL(encodeURIComponent(file), root), 'utf8')).replace(/^\uFEFF/, ''))
    if (!input.metadata || !Array.isArray(input.messages) || !input.messages.every((m) =>
      ['Prompt', 'Response'].includes(m?.role) && typeof m.say === 'string' && m.say.trim())) continue
    const [chat] = parseExport(input).conversations
    assert.equal(chat.messages.length, input.messages.length)
    assert.equal(chat.paths[0].source_ids.length, input.messages.length)
    assert.equal(chat.messages[0].text, input.messages[0].say.trim())
    assert.ok(chat.messages.every((message) => message.timestamp === null && message.message_id_is_local))
    assert.deepEqual(mergeImported([chat], parseExport(input).conversations), [chat])
    tested++
  }
  if (!tested) t.skip('No matching private text-only exports in this checkout')
})
