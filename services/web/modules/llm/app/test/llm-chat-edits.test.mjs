// Node >= 22.18 supports type stripping; no editor or web service is required.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locateChatEdit, parseChatEdits, normalizeChatPath } from '../../frontend/js/utils/llm-chat-edits.ts'

const edit = { file: 'chapters/main.tex', oldText: '\\section{Old}', newText: '\\section{New}' }
const fence = value => '```overleaf-edit\n' + JSON.stringify(value) + '\n```'
test('extracts structured edits while retaining explanatory Markdown', () => {
    const result = parseChatEdits('Explanation\n' + fence(edit) + '\nDone')
    assert.deepEqual(result.edits, [edit])
    assert.equal(result.markdown, 'Explanation\n\nDone')
})
test('invalid JSON, insertion without anchor, and no-op remain visible as code', () => {
    for (const block of ['```overleaf-edit\ninvalid\n```', fence({ ...edit, oldText: '' }), fence({ ...edit, newText: edit.oldText }), fence(null), fence({ ...edit, file: 1 })]) {
        assert.deepEqual(parseChatEdits(block), { markdown: block, edits: [] })
    }
})
test('matches a unique original in the exact project path', () => {
    assert.deepEqual(locateChatEdit('start\n' + edit.oldText, '/chapters/main.tex', edit), { from: 6, to: 6 + edit.oldText.length, insert: edit.newText })
    assert.equal(normalizeChatPath('./chapters/main.tex'), 'chapters/main.tex')
})
test('refuses wrong folder, stale text, ambiguous text and overlapping matches', () => {
    assert.equal(locateChatEdit(edit.oldText, 'other/main.tex', edit), null)
    assert.equal(locateChatEdit('changed', edit.file, edit), null)
    assert.equal(locateChatEdit(edit.oldText + edit.oldText, edit.file, edit), null)
    assert.equal(locateChatEdit('aaa', edit.file, { ...edit, oldText: 'aa' }), null)
})
test('deletions and anchored insertions are supported', () => {
    assert.equal(locateChatEdit(edit.oldText, edit.file, { ...edit, newText: '' }).insert, '')
    assert.equal(locateChatEdit(edit.oldText, edit.file, { ...edit, newText: edit.oldText + '\nextra' }).insert, edit.oldText + '\nextra')
})
test('caps suggestions and preserves overflow code for manual inspection', () => {
    const result = parseChatEdits(Array(13).fill(fence(edit)).join('\n'))
    assert.equal(result.edits.length, 12)
    assert.match(result.markdown, /overleaf-edit/)
})

test('editor bridge requests capture live data at request time and require explicit success', async () => {
    const { requestEditorSnapshot, applyChatEdit } = await import('../../frontend/js/utils/llm-chat-edits.ts')
    const previousWindow = globalThis.window
    globalThis.window = new EventTarget()
    try {
        assert.equal(requestEditorSnapshot(), undefined)
        assert.equal(applyChatEdit(edit), false)
        let currentText = 'before'
        window.addEventListener('llm-chat-snapshot', e => { e.detail.snapshot = { file: edit.file, text: currentText } })
        assert.equal(requestEditorSnapshot().text, 'before')
        currentText = 'after'
        assert.equal(requestEditorSnapshot().text, 'after')
        window.addEventListener('llm-chat-apply', e => { e.detail.ok = e.detail.edit.file === edit.file })
        assert.equal(applyChatEdit(edit), true)
        assert.equal(applyChatEdit({ ...edit, file: 'elsewhere.tex' }), false)
    } finally {
        globalThis.window = previousWindow
    }
})
