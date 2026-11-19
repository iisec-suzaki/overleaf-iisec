import getMeta from '@/utils/meta'
// Extension point wrapper for sourceEditorExtensions
// Provides the CodeMirror inline completion extension.
// Must be exported as a function (options) => Extension to match the consumer contract.
import { chatPreviewExtension } from './llm-chat-preview'
import { inlineCompletionExtension } from '../components/llm-completion'

export const extension = (_options: Record<string, any>) =>
  getMeta('ol-ExposedSettings')?.llmEnabled
    ? [inlineCompletionExtension(), chatPreviewExtension()]
    : []
