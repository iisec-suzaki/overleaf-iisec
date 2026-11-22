/**
 * エディター ツールバー（左側の編集環境）に置く「現在のファイルを
 * 右の横並びパネルへ移す」ボタンです。
 *
 * settings.defaults.js の sourceEditorToolbarStartButtons スロットから登録され、
 * 公式エディター ツールバーの左端に描画されます。
 *
 * 挙動:
 * 1. メインエディターで開いているファイルを jp-split:open で右側へ送ります。
 * 2. メイン側に他のタブも残っている場合だけ、公式 tabs context の closeTab で
 *    メインのタブを閉じます（公式仕様により最後の 1 枚は閉じられません。
 *    その場合、右側は「メインで開かれているため読み取り専用」の表示になります）。
 */
import React, { useCallback } from 'react'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useTabsContext } from '@/features/ide-react/context/tabs-context'
import MaterialIcon from '@/shared/components/material-icon'

export default function SplitMoveToRightButton() {
  const editorManager = useEditorManagerContext()
  const { tabs, closeTab } = useTabsContext()

  const onClick = useCallback(() => {
    const docId = editorManager.getCurrentDocumentId()
    if (!docId) return
    // 右側でタブを開く（SplitFilePanel 側の jp-split:open ハンドラへ）。
    window.dispatchEvent(
      new CustomEvent('jp-split:open', { detail: { docId } })
    )
    // メイン側に 2 枚以上タブがあれば、このタブは閉じて「移動」にします。
    if (tabs.some(tab => tab.id === docId) && tabs.length > 1) {
      closeTab(docId)
    }
  }, [closeTab, editorManager, tabs])

  return (
    <div className="jp-split-toolbar-button">
      <button
        type="button"
        className="ol-cm-toolbar-button"
        aria-label="現在のファイルを右の横並びパネルへ移す"
        title="現在のファイルを右の横並びパネルへ移す"
        onClick={onClick}
      >
        <MaterialIcon type="arrow_forward_ios" />
      </button>
    </div>
  )
}
