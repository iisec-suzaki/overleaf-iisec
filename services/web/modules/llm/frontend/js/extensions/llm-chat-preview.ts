import { StateEffect, StateField, type Extension, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { ChatEdit } from '../utils/llm-chat-edits'
import { buildChatDiffRows } from '../utils/llm-chat-diff'

interface ChatPreview {
    id: string
    edit: ChatEdit
    from: number
    to: number
}

export const showChatPreview = StateEffect.define<ChatPreview>()
export const clearChatPreview = StateEffect.define<string>()

// Preview is view-only state. Typing, collaborative updates, Undo and file changes
// invalidate it rather than leaving a suggestion attached to a stale source range.
export const chatPreviewState = StateField.define<ChatPreview | null>({
    create: () => null,
    update(value, transaction) {
        if (transaction.docChanged) return null
        for (const effect of transaction.effects) {
            if (effect.is(showChatPreview)) value = effect.value
            if (effect.is(clearChatPreview) && value?.id === effect.value) value = null
        }
        return value
    },
})

function previewDecorations(state: EditorState) {
    const preview = state.field(chatPreviewState)
    if (!preview) return Decoration.none
    const doc = state.doc
    const startLine = doc.lineAt(preview.from).number
    const rows = buildChatDiffRows(preview.edit.oldText, preview.edit.newText, startLine)
    const decorations = [Decoration.mark({ class: 'cm-llm-preview-anchor' }).range(preview.from, preview.to)]
    const removedLines = new Set(rows.filter(row => row.kind === 'removed').map(row => row.oldLine!))
    for (const number of removedLines) {
        if (number <= doc.lines) decorations.push(Decoration.line({ class: 'cm-llm-preview-removed' }).range(doc.line(number).from))
    }
    const endLine = doc.lineAt(Math.max(preview.from, preview.to - 1))
    decorations.push(Decoration.widget({
        widget: new ChatPreviewWidget(preview, startLine, endLine.number),
        block: true,
        side: 1,
    }).range(endLine.to))
    return Decoration.set(decorations, true)
}

class ChatPreviewWidget extends WidgetType {
    readonly preview: ChatPreview
    readonly startLine: number
    readonly endLine: number
    constructor(preview: ChatPreview, startLine: number, endLine: number) {
        super()
        this.preview = preview
        this.startLine = startLine
        this.endLine = endLine
    }
    eq(other: ChatPreviewWidget) {
        return other.preview === this.preview && other.startLine === this.startLine && other.endLine === this.endLine
    }
    toDOM(view: EditorView) {
        const element = view.dom.ownerDocument.createElement('div')
        element.className = 'cm-llm-chat-preview'
        element.setAttribute('aria-label', 'AI変更案のプレビュー')
        const header = element.appendChild(element.ownerDocument.createElement('div'))
        header.className = 'cm-llm-chat-preview-header'
        const title = header.appendChild(element.ownerDocument.createElement('span'))
        title.textContent = `AI変更案 · ${this.preview.edit.file} · ${this.startLine}–${this.endLine}行`
        for (const [action, label] of [['apply', '適用'], ['dismiss', '却下'], ['close', '閉じる']] as const) {
            const button = header.appendChild(element.ownerDocument.createElement('button'))
            button.type = 'button'
            button.textContent = label
            button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('llm-chat-review-action', {
                detail: { id: this.preview.id, action },
            })))
        }
        const code = element.appendChild(element.ownerDocument.createElement('pre'))
        for (const row of buildChatDiffRows(this.preview.edit.oldText, this.preview.edit.newText, this.startLine)) {
            if (row.kind === 'removed') continue
            const line = code.appendChild(element.ownerDocument.createElement('div'))
            line.className = row.kind === 'added' ? 'cm-llm-preview-added' : 'cm-llm-preview-context'
            line.textContent = `${String(row.newLine).padStart(4)} ${row.kind === 'added' ? '+' : ' '} ${row.text}`
        }
        if (!this.preview.edit.newText) code.textContent = '− この範囲を削除'
        return element
    }
    ignoreEvent() { return true }
}

export function chatPreviewExtension(): Extension {
    return [
        chatPreviewState,
        EditorView.decorations.compute([chatPreviewState], previewDecorations),
        EditorView.updateListener.of(update => {
            const before = update.startState.field(chatPreviewState)
            const after = update.state.field(chatPreviewState)
            if (before?.id !== after?.id) window.dispatchEvent(new CustomEvent('llm-chat-preview-status', {
                detail: { id: after?.id },
            }))
            if (update.docChanged) window.dispatchEvent(new CustomEvent('llm-chat-document-changed'))
        }),
    ]
}
