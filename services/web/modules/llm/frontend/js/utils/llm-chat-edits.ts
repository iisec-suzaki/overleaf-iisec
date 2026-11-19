export interface ChatEdit {
  file: string
  oldText: string
  newText: string
}

export interface EditorSnapshot {
  file: string
  text: string
  from: number
  selection: string
  truncated: boolean
}

export const normalizeChatPath = (path: string) =>
  path.replace(/^\/?(?:\.\/)?/, '')

// Only a unique, exact match in the named file may be edited. Never guess a range.
export function locateChatEdit(text: string, file: string, edit: ChatEdit) {
  if (normalizeChatPath(file) !== normalizeChatPath(edit.file)) return null
  if (!edit.oldText || edit.oldText === edit.newText) return null
  const from = text.indexOf(edit.oldText)
  if (from < 0 || text.indexOf(edit.oldText, from + 1) !== -1) return null
  return { from, to: from + edit.oldText.length, insert: edit.newText }
}

export function parseChatEdits(content: string) {
  const edits: ChatEdit[] = []
  const markdown = content.replace(
    /^```overleaf-edit\s*\n([\s\S]*?)^```[ \t]*$/gm,
    (block, json) => {
      try {
        const edit = JSON.parse(json)
        if (
          edits.length >= 12 ||
          !edit ||
          typeof edit.file !== 'string' ||
          !edit.file ||
          typeof edit.oldText !== 'string' ||
          !edit.oldText ||
          typeof edit.newText !== 'string' ||
          edit.oldText === edit.newText ||
          edit.oldText.length + edit.newText.length > 40000
        )
          return block
        edits.push({
          file: edit.file,
          oldText: edit.oldText,
          newText: edit.newText,
        })
        return ''
      } catch {
        return block
      }
    }
  )
  return { markdown, edits }
}

// The editor and chat live under different React providers. Requests are synchronous,
// local DOM events; no editor text is retained on window between requests.
export function requestEditorSnapshot(): EditorSnapshot | undefined {
  const detail: { snapshot?: EditorSnapshot } = {}
  window.dispatchEvent(new CustomEvent('llm-chat-snapshot', { detail }))
  return detail.snapshot
}

export function applyChatEdit(edit: ChatEdit): boolean {
  const detail = { edit, ok: false }
  window.dispatchEvent(new CustomEvent('llm-chat-apply', { detail }))
  return detail.ok
}

export interface ChatEditLocation {
  startLine: number
  endLine: number
}

export function locateChatEditInEditor(
  edit: ChatEdit
): ChatEditLocation | undefined {
  const detail: { edit: ChatEdit; location?: ChatEditLocation } = { edit }
  window.dispatchEvent(new CustomEvent('llm-chat-locate', { detail }))
  return detail.location
}

export function previewChatEdit(edit: ChatEdit, id: string): boolean {
  const detail = { edit, id, ok: false }
  window.dispatchEvent(new CustomEvent('llm-chat-preview', { detail }))
  return detail.ok
}

export function clearChatEditPreview(id: string) {
  window.dispatchEvent(
    new CustomEvent('llm-chat-preview-clear', { detail: { id } })
  )
}
