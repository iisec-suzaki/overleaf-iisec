// Extension point wrapper for sourceEditorComponents
// Provides root-level LLM editor features (inline completion, floating toolbar)
import React, { useEffect, useRef } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import LLMToolbar, { LLMToolbarHandle } from './llm-toolbar'
import { FileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { locateChatEdit } from '../utils/llm-chat-edits'
import { EditorView } from '@codemirror/view'
import {
  chatPreviewState,
  showChatPreview,
  clearChatPreview,
} from '../extensions/llm-chat-preview'
import { isolateHistory } from '@codemirror/commands'
import { useLLMFeatures } from '../hooks/use-llm-features'

function LLMSourceEditorComponent() {
  const view = useCodeMirrorViewContext()
  const toolbarRef = useRef<LLMToolbarHandle>(null)

  // overleaf-lab: publish the chat feature flag on window so the review-tooltip
  // core patch can hide its "Ask AI" entry when chat is disabled. That entry lives
  // in a core component that only knows the module flag (llmEnabled), not the
  // runtime chat toggle; this bridges the runtime flag to it. Defaults to enabled
  // until the flags load, matching the pre-flag behavior.
  const features = useLLMFeatures()
  useEffect(() => {
    ;(window as any).__llmChatEnabled = features.chatEnabled
  }, [features.chatEnabled])

  // overleaf-lab (2026): AI Error Assist "Apply fix" — the log-pane card
  // (outside this context) can't reach the CodeMirror view directly, so it
  // posts a request event; we're inside CodeMirrorViewContext.Provider, so
  // we own the edit: exact-match the suggested text in the open document,
  // dispatch a CM transaction (the realtime OT extension syncs it), and
  // reply. Safe by construction: any mismatch (file changed, wrong doc,
  // pure deletion of something not present) is refused, never fuzzy-applied.
  const { openDocName, currentDocumentId, currentDocument } =
    useEditorOpenDocContext()
  const { trackedWrite } = usePermissionsContext()
  const paths = React.useContext(FileTreePathContext)
  const currentPath =
    currentDocumentId && paths?.pathInFolder(String(currentDocumentId))
  const isMainDocument =
    currentDocument?.doc_id === currentDocumentId &&
    currentDocument?.cm6?.view === view
  useEffect(() => {
    // 修正案は現在のメイン文書だけに結び付けます。別タブのビューや切替中の
    // 古い文書は、本文参照・プレビュー・適用のいずれにも使いません。
    if (!view || !currentPath || !isMainDocument) return
    const snapshot = (event: Event) => {
      const doc = view.state.doc
      const selection = view.state.selection.main
      const from = Math.max(0, selection.from - 6000)
      const to = Math.min(doc.length, from + 20000)
      ;(event as CustomEvent).detail.snapshot = {
        file: currentPath,
        text: doc.sliceString(from, to),
        from,
        selection: doc.sliceString(
          selection.from,
          Math.min(selection.to, selection.from + 8000)
        ),
        truncated: from > 0 || to < doc.length,
      }
    }
    const apply = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (
        !trackedWrite ||
        view.state.readOnly ||
        !view.state.facet(EditorView.editable) ||
        !detail?.edit
      )
        return
      const change = locateChatEdit(
        view.state.doc.toString(),
        currentPath,
        detail.edit
      )
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
      const change = locateChatEdit(
        view.state.doc.toString(),
        currentPath,
        detail.edit
      )
      if (!change) return
      detail.location = {
        startLine: view.state.doc.lineAt(change.from).number,
        endLine: view.state.doc.lineAt(Math.max(change.from, change.to - 1))
          .number,
      }
    }
    const preview = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (
        !detail?.edit ||
        !detail.id ||
        view.state.field(chatPreviewState, false) === undefined
      )
        return
      const change = locateChatEdit(
        view.state.doc.toString(),
        currentPath,
        detail.edit
      )
      if (!change) return
      view.dispatch({
        effects: [
          showChatPreview.of({
            id: detail.id,
            edit: detail.edit,
            from: change.from,
            to: change.to,
          }),
          EditorView.scrollIntoView(change.from, { y: 'center' }),
        ],
      })
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
      if (active && !view.destroyed)
        view.dispatch({ effects: clearChatPreview.of(active.id) })
      window.removeEventListener('llm-chat-locate', locate)
      window.removeEventListener('llm-chat-preview', preview)
      window.removeEventListener('llm-chat-preview-clear', clearPreview)
      window.dispatchEvent(
        new CustomEvent('llm-chat-preview-status', { detail: {} })
      )
      window.removeEventListener('llm-chat-snapshot', snapshot)
      window.removeEventListener('llm-chat-apply', apply)
      window.dispatchEvent(new CustomEvent('llm-chat-document-changed'))
    }
  }, [view, currentPath, trackedWrite, isMainDocument])
  useEffect(() => {
    const handleApply = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const reqId = detail.reqId
      if (!reqId || !view || !isMainDocument) return
      const reply = (
        ok: boolean,
        reason?: string,
        extra?: Record<string, unknown>
      ) => {
        window.dispatchEvent(
          new CustomEvent('llm-cfx-apply-reply', {
            detail: { reqId, ok, reason, ...extra },
          })
        )
      }
      try {
        if (
          !trackedWrite ||
          view.state.readOnly ||
          !view.state.facet(EditorView.editable)
        ) {
          return reply(false, 'read-only')
        }
        // 行番号だけでの挿入や、同名ファイルへの推測適用は行いません。
        // コンパイル時の本文と現在の本文が一意に一致するときだけ適用します。
        const change = locateChatEdit(
          view.state.doc.toString(),
          currentPath || '',
          {
            file: String(detail.file || '').replace(/^\/?compile\//, ''),
            oldText: String(detail.suggestedOld || ''),
            newText: String(detail.suggestedNew || ''),
          }
        )
        if (!change) return reply(false, 'not-found', { openDoc: openDocName })
        const { from, to, insert: newText } = change
        view.dispatch({
          changes: { from, to, insert: newText },
          annotations: isolateHistory.of('full'),
          selection: { anchor: from + newText.length },
          scrollIntoView: true,
        })
        view.focus()
        reply(true)
      } catch (err) {
        reply(false, 'internal', { error: (err as Error).message })
      }
    }
    window.addEventListener('llm-cfx-apply-request', handleApply)
    return () =>
      window.removeEventListener('llm-cfx-apply-request', handleApply)
  }, [view, openDocName, trackedWrite, currentPath, isMainDocument])

  // Listen for "Ask AI" from the review tooltip menu
  useEffect(() => {
    const handleAskAI = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (
        !detail?.text ||
        !view ||
        !toolbarRef.current ||
        !isMainDocument ||
        (detail.view && detail.view !== view)
      )
        return
      // overleaf-lab: chat disabled by admin -> do not open the toolbar.
      if (features.chatEnabled === false) return
      const range = detail.range || view.state.selection.main
      toolbarRef.current.show(view, {
        text: detail.text,
        range: { from: range.from, to: range.to },
      })
      // Immediately open the menu panel
      toolbarRef.current.openMenu?.()
    }
    document.addEventListener('llm-ask-ai-selection', handleAskAI)
    return () =>
      document.removeEventListener('llm-ask-ai-selection', handleAskAI)
  }, [view, features.chatEnabled, isMainDocument])

  return <LLMToolbar ref={toolbarRef} />
}

export default LLMSourceEditorComponent
