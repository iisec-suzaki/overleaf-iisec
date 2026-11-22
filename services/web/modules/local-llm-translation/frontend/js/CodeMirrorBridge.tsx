/**
 * 「ブリッジ」用コンポーネント（表示は何もしません）。
 *
 * sourceEditorToolbarComponents（settings.defaults.js）から LaTeX エディタの
 * ツールバーへ登録され、開いているエディターの CodeMirror インスタンスを
 * モジュール変数に保持します。左レールの翻訳パネル・AI アシスタントは
 * CodeMirror のコンテキスト外にいるため、この中継が必要になります。
 *
 * 表示されるのは現在選択中のタブのエディターのみ（ide-react は現在の
 ドキュメントだけマウントする）なので、保持されるインスタンスは常に 1 つです。
 */
import { useEffect } from 'react'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'

type BridgedEditor = { state: EditorState; view: EditorView }

let bridged: BridgedEditor | null = null
const listeners = new Set<() => void>()

/** 現在開かれているエディターインスタンス（エディター未表示なら null）。 */
export function getBridgedEditor(): BridgedEditor | null {
  return bridged
}

/** 「エディターが切り替わった」の購読。解除関数を返します。 */
export function subscribeBridgedEditor(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export default function CodeMirrorBridge() {
  const state = useCodeMirrorStateContext()
  const view = useCodeMirrorViewContext()

  // レンダリングのたびに最新へ更新します（view は常に最新文書を持つオブジェクト）。
  bridged = { state, view }

  useEffect(() => {
    listeners.forEach(listener => listener())
    return () => {
      // このコンポーネントが外れるときだけ、現在保持分を消します。
      if (bridged && bridged.view === view) {
        bridged = null
        listeners.forEach(listener => listener())
      }
    }
  }, [state, view])

  return null
}
