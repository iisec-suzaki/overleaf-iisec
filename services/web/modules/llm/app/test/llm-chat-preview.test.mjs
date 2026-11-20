import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { buildChatDiffRows } from '../../frontend/js/utils/llm-chat-diff.ts'
// The application bundler resolves extensionless TypeScript imports. Mirror that
// resolution for this standalone Node 24 test, without altering the app modules.
const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !specifier.endsWith('.ts')) {
        const url = new URL(specifier + '.ts', context.parentURL)
        if (existsSync(url)) return { url: url.href, shortCircuit: true }
    }
    return next(specifier, context)
} })
const { chatPreviewExtension, chatPreviewState, showChatPreview, clearChatPreview } = await import('../../frontend/js/extensions/llm-chat-preview.ts')
hooks.deregister()

const edit = { file: 'main.tex', oldText: 'old\nkeep', newText: 'new\nextra\nkeep' }
const preview = { id: 'first', edit, from: 7, to: 15 }
const createState = () => EditorState.create({ doc: 'before\nold\nkeep\nafter', extensions: [chatPreviewExtension()] })

test('unified diff tracks actual source and proposed line numbers independently', () => {
    assert.deepEqual(buildChatDiffRows(edit.oldText, edit.newText, 42), [
        { kind: 'removed', text: 'old', oldLine: 42, newLine: undefined },
        { kind: 'added', text: 'new', oldLine: undefined, newLine: 42 },
        { kind: 'added', text: 'extra', oldLine: undefined, newLine: 43 },
        { kind: 'unchanged', text: 'keep', oldLine: 43, newLine: 44 },
    ])
})
test('empty lines, pure deletion, insertion and trailing newline are numbered correctly', () => {
    assert.equal(buildChatDiffRows('a\n\nb\n', 'a\nb\n', 8).find(row => row.kind === 'removed').oldLine, 9)
    assert.deepEqual(buildChatDiffRows('old', '', 10), [{ kind: 'removed', text: 'old', oldLine: 10, newLine: undefined }])
    assert.equal(buildChatDiffRows('old\n', 'old\nnew\n', 10).at(-1).newLine, 11)
    assert.equal(buildChatDiffRows('a\n', 'b\n').length, 2)
})
test('preview decorates the original and adds a block widget without changing source', () => {
    const original = createState()
    const state = original.update({ effects: showChatPreview.of(preview) }).state
    assert.equal(state.doc.toString(), original.doc.toString())
    assert.equal(state.field(chatPreviewState).id, 'first')
    const decorations = state.facet(EditorView.decorations)
    const specs = []
    for (const set of decorations) set.between(0, state.doc.length, (from, to, value) => specs.push({ from, to, ...value.spec }))
    assert.ok(specs.some(spec => spec.class === 'cm-llm-preview-removed' && spec.from === 7))
    assert.ok(specs.some(spec => spec.widget && spec.block && spec.from === 15))
})
test('typing and remote source changes invalidate previews instead of mapping stale suggestions', () => {
    const state = createState().update({ effects: showChatPreview.of(preview) }).state
    assert.equal(state.update({ changes: { from: 0, insert: 'remote\n' } }).state.field(chatPreviewState), null)
})
test('closing one proposal cannot close another, and only one preview is active', () => {
    let state = createState().update({ effects: showChatPreview.of(preview) }).state
    state = state.update({ effects: showChatPreview.of({ ...preview, id: 'second' }) }).state
    state = state.update({ effects: clearChatPreview.of('first') }).state
    assert.equal(state.field(chatPreviewState).id, 'second')
    state = state.update({ effects: clearChatPreview.of('second') }).state
    assert.equal(state.field(chatPreviewState), null)
})

test('inline widget labels real source lines and routes review controls to its card', () => {
    const state = createState().update({ effects: showChatPreview.of(preview) }).state
    let widget
    for (const set of state.facet(EditorView.decorations)) {
        set.between(0, state.doc.length, (from, to, decoration) => { if (decoration.spec.widget) widget = decoration.spec.widget })
    }
    class Element {
        children = []
        textContent = ''
        listeners = new Map()
        constructor(ownerDocument) { this.ownerDocument = ownerDocument }
        appendChild(child) { this.children.push(child); return child }
        setAttribute() {}
        addEventListener(event, listener) { this.listeners.set(event, listener) }
    }
    const document = { createElement: () => new Element(document) }
    const previousWindow = globalThis.window
    globalThis.window = new EventTarget()
    try {
        const actions = []
        window.addEventListener('llm-chat-review-action', event => actions.push(event.detail))
        const element = widget.toDOM({ dom: { ownerDocument: document } })
        const header = element.children[0]
        assert.match(header.children[0].textContent, /main.tex · 2–3行/)
        assert.deepEqual(header.children.slice(1).map(button => button.textContent), ['適用', '却下', '閉じる'])
        for (const button of header.children.slice(1)) button.listeners.get('click')()
        assert.deepEqual(actions, ['apply', 'dismiss', 'close'].map(action => ({ id: 'first', action })))
        const added = element.children[1].children.filter(line => line.className === 'cm-llm-preview-added')
        assert.equal(added.length, 2)
        assert.match(added[0].textContent, /2 \+ new/)
    } finally { globalThis.window = previousWindow }
})
