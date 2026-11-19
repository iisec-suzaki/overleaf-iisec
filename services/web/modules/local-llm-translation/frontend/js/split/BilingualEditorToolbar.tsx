import { redo, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { useTranslation } from 'react-i18next'
import { ToolbarButton } from '@/features/source-editor/components/toolbar/toolbar-button'
import * as commands from '@/features/source-editor/extensions/toolbar/commands'
import {
  findCurrentSectionHeadingLevel,
  setSectionHeadingLevel,
} from '@/features/source-editor/extensions/toolbar/sections'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import '@/../stylesheets/components/editor-toolbar.scss'

/**
 * 公式の書式ボタン・コマンドを、横並び側のCodeMirrorコンテキストで再利用します。
 * 文書切替・コンパイル等のメイン専用操作は含めず、本文変更は通常の変更通知へ流します。
 * そのため自動保存・版照合・Undoは、手入力と同じ経路で処理されます。
 */
export default function BilingualEditorToolbar({ docId }: { docId: string }) {
  const state = useCodeMirrorStateContext()
  const { t } = useTranslation()
  const button = (
    id: string,
    label: string,
    icon: string,
    command: (view: EditorView) => unknown,
    edits = true
  ) => (
    <ToolbarButton
      key={id}
      id={`bilingual-${docId}-${id}`}
      label={label}
      icon={icon}
      disabled={edits && state.readOnly}
      command={view => {
        // 開いたメニューの描画後に権限が変わっても、最新の状態で書き込みを止めます。
        if (!edits || !view.state.readOnly) command(view)
      }}
    />
  )
  return (
    <div
      role="toolbar"
      aria-label="横並びエディターの書式"
      className="ol-cm-toolbar-wrapper"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}
    >
      {button('undo', t('toolbar_undo'), 'undo', undo)}
      {button('redo', t('toolbar_redo'), 'redo', redo)}
      <HeadingLevel />
      {button('bold', t('toolbar_bold'), 'format_bold', commands.toggleBold)}
      {button(
        'italic',
        t('toolbar_italic'),
        'format_italic',
        commands.toggleItalic
      )}
      {button(
        'inline-math',
        t('inline_math', 'Inline math'),
        'functions',
        commands.wrapInInlineMath
      )}
      {button(
        'display-math',
        t('display_math', 'Display math'),
        'functions',
        commands.wrapInDisplayMath
      )}
      {button(
        'bullet-list',
        t('toolbar_bulleted_list', 'Bulleted list'),
        'format_list_bulleted',
        commands.toggleBulletList
      )}
      {button(
        'numbered-list',
        t('toolbar_numbered_list', 'Numbered list'),
        'format_list_numbered',
        commands.toggleNumberedList
      )}
      {button(
        'link',
        t('toolbar_insert_link'),
        'add_link',
        commands.wrapInHref
      )}
      {button('search', t('search'), 'search', commands.toggleSearch, false)}
    </div>
  )
}

function HeadingLevel() {
  const state = useCodeMirrorStateContext()
  const view = useCodeMirrorViewContext()
  const { t } = useTranslation()
  return (
    <select
      aria-label={t('toolbar_section_heading_level')}
      className="form-select form-select-sm"
      style={{ width: 'auto' }}
      value={findCurrentSectionHeadingLevel(state)?.level || 'text'}
      disabled={state.readOnly}
      onChange={event => {
        if (!view.state.readOnly) {
          setSectionHeadingLevel(view, event.target.value)
          view.focus()
        }
      }}
    >
      {[
        'text',
        'section',
        'subsection',
        'subsubsection',
        'paragraph',
        'subparagraph',
      ].map(level => (
        <option key={level} value={level}>
          {level === 'text' ? t('normal_text', 'Normal text') : level}
        </option>
      ))}
    </select>
  )
}
