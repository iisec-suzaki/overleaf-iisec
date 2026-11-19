import { createContext, forwardRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history, undo } from '@codemirror/commands'
import EditorBridge from '../frontend/js/components/llm-source-editor-component'
import {
  applyChatEdit,
  requestEditorSnapshot,
  previewChatEdit,
} from '../frontend/js/utils/llm-chat-edits'
import {
  chatPreviewExtension,
  chatPreviewState,
} from '../frontend/js/extensions/llm-chat-preview'
const state = vi.hoisted(() => ({
  view: null as any,
  main: null as any,
  write: true,
  path: 'a/main.tex',
}))
vi.mock('@/features/source-editor/components/codemirror-context', () => ({
  useCodeMirrorViewContext: () => state.view,
}))
vi.mock('@/features/ide-react/context/editor-open-doc-context', () => ({
  useEditorOpenDocContext: () => ({
    currentDocumentId: 'doc',
    currentDocument: { doc_id: 'doc', cm6: { view: state.main } },
    openDocName: 'main.tex',
  }),
}))
vi.mock('@/features/ide-react/context/permissions-context', () => ({
  usePermissionsContext: () => ({ trackedWrite: state.write }),
}))
vi.mock('@/features/file-tree/contexts/file-tree-path', () => ({
  FileTreePathContext: createContext({ pathInFolder: () => state.path }),
}))
vi.mock('../frontend/js/hooks/use-llm-features', () => ({
  useLLMFeatures: () => ({ loaded: true, chatEnabled: true }),
}))
vi.mock('../frontend/js/components/llm-toolbar', () => ({
  default: forwardRef(() => null),
}))
const edit = { file: 'a/main.tex', oldText: 'old', newText: 'new' }
beforeEach(() => {
  state.write = true
  state.path = 'a/main.tex'
  state.view = new EditorView({
    state: EditorState.create({
      doc: 'before old after',
      extensions: [history(), chatPreviewExtension()],
    }),
    parent: document.body,
  })
  state.main = state.view
})
afterEach(() => {
  cleanup()
  state.view.destroy()
})
it('applies an exact proposal through CodeMirror and preserves undo', () => {
  render(<EditorBridge />)
  expect(applyChatEdit(edit)).toBe(true)
  expect(state.view.state.doc.toString()).toBe('before new after')
  expect(undo(state.view)).toBe(true)
  expect(state.view.state.doc.toString()).toBe('before old after')
})
it('refuses stale text, another folder with the same basename, and read-only users', () => {
  const mounted = render(<EditorBridge />)
  expect(applyChatEdit({ ...edit, file: 'b/main.tex' })).toBe(false)
  state.view.dispatch({ changes: { from: 7, to: 10, insert: 'edited' } })
  expect(applyChatEdit(edit)).toBe(false)
  state.write = false
  mounted.rerender(<EditorBridge />)
  expect(applyChatEdit({ ...edit, oldText: 'edited' })).toBe(false)
  expect(state.view.state.doc.toString()).toBe('before edited after')
})
it('does not read or edit a side view while the main view is changing', () => {
  state.main = {}
  render(<EditorBridge />)
  expect(requestEditorSnapshot()).toBeUndefined()
  expect(applyChatEdit(edit)).toBe(false)
})
it('preview leaves source unchanged and clears after an actual edit', () => {
  render(<EditorBridge />)
  expect(previewChatEdit(edit, 'proposal')).toBe(true)
  expect(state.view.state.doc.toString()).toBe('before old after')
  expect(state.view.state.field(chatPreviewState).id).toBe('proposal')
  state.view.dispatch({ changes: { from: 0, insert: 'changed ' } })
  expect(state.view.state.field(chatPreviewState)).toBeNull()
})
it('compile fixes cannot apply to a different folder with the same basename', () => {
  render(<EditorBridge />)
  const replies: any[] = []
  const handler = (event: Event) => replies.push((event as CustomEvent).detail)
  window.addEventListener('llm-cfx-apply-reply', handler)
  try {
    window.dispatchEvent(
      new CustomEvent('llm-cfx-apply-request', {
        detail: {
          reqId: 'fix',
          file: 'compile/b/main.tex',
          suggestedOld: 'old',
          suggestedNew: 'new',
          line: 1,
        },
      })
    )
    expect(replies[0].ok).toBe(false)
    expect(state.view.state.doc.toString()).toBe('before old after')
  } finally {
    window.removeEventListener('llm-cfx-apply-reply', handler)
  }
})
