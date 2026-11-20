// Extension point wrapper for sourceEditorComponents
// Provides root-level LLM editor features (inline completion, floating toolbar)
import React, { useEffect, useRef, useState } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import LLMToolbar, { LLMToolbarHandle } from './llm-toolbar'
import { FileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { locateChatEdit } from '../utils/llm-chat-edits'
import { EditorView } from '@codemirror/view'
import { chatPreviewState, showChatPreview, clearChatPreview } from '../extensions/llm-chat-preview'
import { isolateHistory } from '@codemirror/commands'
import { useLLMFeatures } from '../hooks/use-llm-features'

function LLMSourceEditorComponent() {
    const view = useCodeMirrorViewContext()
    const toolbarRef = useRef<LLMToolbarHandle>(null)
    const [extensionInstalled, setExtensionInstalled] = useState(false)

    // overleaf-lab: publish the chat feature flag on window so the review-tooltip
    // core patch can hide its "Ask AI" entry when chat is disabled. That entry lives
    // in a core component that only knows the module flag (llmEnabled), not the
    // runtime chat toggle; this bridges the runtime flag to it. Defaults to enabled
    // until the flags load, matching the pre-flag behavior.
    const features = useLLMFeatures()
    useEffect(() => {
        ;(window as any).__llmChatEnabled = features.chatEnabled
    }, [features.chatEnabled])

    // Install inline completion extension
    useEffect(() => {
        if (!view || extensionInstalled) return
        try {
            // overleaf-lab: the extension itself registers through the
            // sourceEditorExtensions config entry; here we only flip the
            // installed flag once the view exists.
            view.dispatch({
                effects: (window as any).__cm_llm_reconfigure
                    ? []
                    : // @ts-ignore
                    [],
            })
            setExtensionInstalled(true)
        } catch {
            // Extension may already be active or view not ready
        }
    }, [view, extensionInstalled])

    // overleaf-lab (2026): AI Error Assist "Apply fix" — the log-pane card
    // (outside this context) can't reach the CodeMirror view directly, so it
    // posts a request event; we're inside CodeMirrorViewContext.Provider, so
    // we own the edit: exact-match the suggested text in the open document,
    // dispatch a CM transaction (the realtime OT extension syncs it), and
    // reply. Safe by construction: any mismatch (file changed, wrong doc,
    // pure deletion of something not present) is refused, never fuzzy-applied.
    const { openDocName, currentDocumentId } = useEditorOpenDocContext()
    const { trackedWrite } = usePermissionsContext()
    const paths = React.useContext(FileTreePathContext)
    const currentPath = currentDocumentId && paths?.pathInFolder(String(currentDocumentId))
    useEffect(() => {
        if (!view || !currentPath) return
        const snapshot = (event: Event) => {
            const doc = view.state.doc
            const selection = view.state.selection.main
            const from = Math.max(0, selection.from - 6000)
            const to = Math.min(doc.length, from + 20000)
            ;(event as CustomEvent).detail.snapshot = {
                file: currentPath,
                text: doc.sliceString(from, to),
                from,
                selection: doc.sliceString(selection.from, Math.min(selection.to, selection.from + 8000)),
                truncated: from > 0 || to < doc.length,
            }
        }
        const apply = (event: Event) => {
            const detail = (event as CustomEvent).detail
            if (!trackedWrite || !detail?.edit) return
            const change = locateChatEdit(view.state.doc.toString(), currentPath, detail.edit)
            if (!change) return
            view.dispatch({
                changes: change,
                annotations: isolateHistory.of('full'),
                selection: { anchor: change.from + change.insert.length },
                scrollIntoView: true,
            })
            detail.ok = true
            view.focus()
        }
        const locate = (event: Event) => {
            const detail = (event as CustomEvent).detail
            if (!detail?.edit) return
            const change = locateChatEdit(view.state.doc.toString(), currentPath, detail.edit)
            if (!change) return
            detail.location = {
                startLine: view.state.doc.lineAt(change.from).number,
                endLine: view.state.doc.lineAt(Math.max(change.from, change.to - 1)).number,
            }
        }
        const preview = (event: Event) => {
            const detail = (event as CustomEvent).detail
            if (!detail?.edit || !detail.id || view.state.field(chatPreviewState, false) === undefined) return
            const change = locateChatEdit(view.state.doc.toString(), currentPath, detail.edit)
            if (!change) return
            view.dispatch({ effects: [
                showChatPreview.of({ id: detail.id, edit: detail.edit, from: change.from, to: change.to }),
                EditorView.scrollIntoView(change.from, { y: 'center' }),
            ] })
            detail.ok = true
        }
        const clearPreview = (event: Event) => {
            const id = (event as CustomEvent).detail?.id
            if (id && view.state.field(chatPreviewState, false)?.id === id) {
                view.dispatch({ effects: clearChatPreview.of(id) })
            }
        }
        window.addEventListener('llm-chat-locate', locate)
        window.addEventListener('llm-chat-preview', preview)
        window.addEventListener('llm-chat-preview-clear', clearPreview)
        window.dispatchEvent(new CustomEvent('llm-chat-document-changed'))
        window.addEventListener('llm-chat-snapshot', snapshot)
        window.addEventListener('llm-chat-apply', apply)
        return () => {
            const active = view.state.field(chatPreviewState, false)
            if (active && !view.destroyed) view.dispatch({ effects: clearChatPreview.of(active.id) })
            window.removeEventListener('llm-chat-locate', locate)
            window.removeEventListener('llm-chat-preview', preview)
            window.removeEventListener('llm-chat-preview-clear', clearPreview)
            window.dispatchEvent(new CustomEvent('llm-chat-preview-status', { detail: {} }))
            window.removeEventListener('llm-chat-snapshot', snapshot)
            window.removeEventListener('llm-chat-apply', apply)
            window.dispatchEvent(new CustomEvent('llm-chat-document-changed'))
        }
    }, [view, currentPath, trackedWrite])
    useEffect(() => {
        const handleApply = (e: Event) => {
            const detail = (e as CustomEvent).detail || {}
            const reqId = detail.reqId
            if (!reqId || !view) return
            const reply = (ok: boolean, reason?: string, extra?: Record<string, unknown>) => {
                window.dispatchEvent(
                    new CustomEvent('llm-cfx-apply-reply', {
                        detail: { reqId, ok, reason, ...extra }
                    })
                )
            }
            try {
                if (!trackedWrite) {
                    return reply(false, 'read-only')
                }
                const base = (s: string | undefined) =>
                    String(s || '').replace(/^\/?compile\//, '').split('/').pop() || ''
                const target = base(detail.file)
                if (target && openDocName && base(openDocName) !== target) {
                    return reply(false, 'wrong-doc', { openDoc: openDocName })
                }
                const doc = view.state.doc
                const oldText = String(detail.suggestedOld || '')
                const newText = String(detail.suggestedNew || '')
                const span = Array.isArray(detail.span)
                    ? [parseInt(detail.span[0], 10), parseInt(detail.span[1], 10)]
                    : null
                let from = -1
                let to = -1
                if (span && span[0] >= 1 && span[1] >= span[0] && span[1] <= doc.lines) {
                    const fromLine = doc.line(span[0])
                    const toLine = doc.line(span[1])
                    const start = fromLine.from
                    const end = toLine.to
                    const slice = doc.sliceString(start, end)
                    if (oldText) {
                        if (slice === oldText) {
                            from = start
                            to = end
                        }
                        // else: fall through to single-line search below
                    } else {
                        from = end
                        to = end
                    }
                }
                if (from === -1) {
                    const lineNo = Math.max(1, Math.min(detail.line || 1, doc.lines))
                    const line = doc.line(lineNo)
                    if (oldText) {
                        const at = line.text.indexOf(oldText)
                        if (at === -1) {
                            return reply(false, 'not-found')
                        }
                        from = line.from + at
                        to = line.from + at + oldText.length
                    } else {
                        from = line.to
                        to = line.to
                    }
                }
                if (from === to && !newText) {
                    return reply(false, 'not-found')
                }
                view.dispatch({
                    changes: { from, to, insert: newText },
                    selection: { anchor: from + newText.length },
                    scrollIntoView: true
                })
                view.focus()
                reply(true)
            }
            catch (err) {
                reply(false, 'internal', { error: (err as Error).message })
            }
        }
        window.addEventListener('llm-cfx-apply-request', handleApply)
        return () => window.removeEventListener('llm-cfx-apply-request', handleApply)
    }, [view, openDocName, trackedWrite])

    // Listen for "Ask AI" from the review tooltip menu
    useEffect(() => {
        const handleAskAI = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (!detail?.text || !view || !toolbarRef.current) return
            // overleaf-lab: chat disabled by admin -> do not open the toolbar.
            if (features.chatEnabled === false) return
            toolbarRef.current.show(view)
            // Immediately open the menu panel
            toolbarRef.current.openMenu?.()
        }
        document.addEventListener('llm-ask-ai-selection', handleAskAI)
        return () => document.removeEventListener('llm-ask-ai-selection', handleAskAI)
    }, [view, features.chatEnabled])

    return <LLMToolbar ref={toolbarRef} />
}

export default LLMSourceEditorComponent
