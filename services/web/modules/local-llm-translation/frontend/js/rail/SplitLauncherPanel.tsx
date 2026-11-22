/**
 * 左レール（セクション）の「横並び表示」タブです。
 *
 * 日本語原文と英語版 .tex を横並びで見るパネル（SplitFilePanel）の起動口です。
 * ファイル一覧から .tex を選ぶとエディターの右に第 3 列として開き、
 * 「閉じる」で取り払います。翻訳保存時に自動で開く経路と同じ
 * jp-split:open / jp-split:close イベントで通信します。
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useProjectContext } from '@/shared/context/project-context'
import withErrorBoundary from '@/infrastructure/error-boundary'
import type { FallbackProps } from 'react-error-boundary'
import { collectTexDocs } from '../split/tex-docs'

/** 横並びパネルへ「このファイルを開いて / 閉じて」と伝えます。 */
function dispatchSplit(event: 'jp-split:open' | 'jp-split:close', docId?: string) {
  window.dispatchEvent(
    new CustomEvent(event, docId ? { detail: { docId } } : undefined)
  )
}

/**
 * パネル共通の簡易エラー境界表示です（公式既定値は空要素のため日本語で代替）。
 */
function PanelErrorFallback({ error }: FallbackProps) {
  return (
    <div style={{ padding: 12, background: 'var(--bg-primary-themed)', color: 'var(--content-primary-themed)' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>パネルの表示に失敗しました</h2>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg-secondary-themed)', padding: 8, border: '1px solid var(--border-primary-themed)', borderRadius: 4 }}>
        {String((error as Error)?.message || error)}
      </pre>
      <p style={{ fontSize: 12, color: 'var(--content-secondary-themed)' }}>
        ブラウザーのコンソール（F12）に詳細ログがあります。この画面を再読み込みすると
        復帰する場合があります。
      </p>
    </div>
  )
}

/** 左レール「横並び表示」タブの本体コンポーネントです。 */
function SplitLauncherPanel() {
  const { projectId } = useProjectContext()
  const editorManager = useEditorManagerContext()
  const { fileTreeData } = useFileTreeData()
  const storageKey = `jp-split-doc:${projectId}`

  const texDocs = useMemo(
    () => collectTexDocs(fileTreeData as unknown),
    [fileTreeData]
  )

  // 現在横並び中（または記憶済み）のファイル ID を表示用追跡します。
  const [openDocId, setOpenDocId] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) || ''
    } catch {
      return ''
    }
  })

  // イベント経由で開閉した結果を反映します（翻訳保存時の自動表示も含む）。
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string }>).detail
      if (detail?.docId) setOpenDocId(detail.docId)
    }
    const onClose = () => setOpenDocId('')
    window.addEventListener('jp-split:open', onOpen)
    window.addEventListener('jp-split:close', onClose)
    return () => {
      window.removeEventListener('jp-split:open', onOpen)
      window.removeEventListener('jp-split:close', onClose)
    }
  }, [])

  const currentDocId = editorManager.getCurrentDocumentId()

  return (
    <div style={panelRootStyle}>
      <h2 style={titleStyle}>横並び表示</h2>
      <p style={hintStyle}>
        選んだ .tex をエディターの右にもう 1 列表示し、日本語原文と英語版を見比べながら
        編集できます（メインエディターで同じファイルを開くと読み取り専用になります）。
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!currentDocId}
          title={currentDocId ? undefined : '先に .tex ファイルを開いてください'}
          onClick={() => {
            if (currentDocId) dispatchSplit('jp-split:open', currentDocId)
          }}
        >
          開いているファイルを横並びに
        </button>
        {openDocId && (
          <button type="button" className="btn btn-secondary" onClick={() => dispatchSplit('jp-split:close')}>
            閉じる
          </button>
        )}
      </div>

      {openDocId && (
        <div role="status" style={noticeStyle}>
          横並び中表示: {texDocs.find(doc => doc.id === openDocId)?.path || '（ファイル名不明）'}
        </div>
      )}

      {texDocs.length === 0 ? (
        <p style={hintStyle}>プロジェクトに .tex ファイルがありません。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {texDocs.map(doc => (
            <button
              key={doc.id}
              type="button"
              className="btn btn-secondary"
              style={{ textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              onClick={() => dispatchSplit('jp-split:open', doc.id)}
            >
              {openDocId === doc.id ? '● ' : ''}
              {doc.path}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- パネルの装飾用スタイル（レール幅に合わせた縦積みの固定値） --------------

const panelRootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: 12,
  gap: 2,
  height: '100%',
  overflowY: 'auto',
  // レールの他パネルと同じテーマ変数に追従させます。
  background: 'var(--bg-primary-themed)',
  color: 'var(--content-primary-themed)',
}

const titleStyle: CSSProperties = { margin: '0 0 6px', fontSize: 17 }

const hintStyle: CSSProperties = { color: 'var(--content-secondary-themed)', margin: '0 0 8px', fontSize: 12 }

const noticeStyle: CSSProperties = {
  margin: '0 0 8px',
  padding: '6px 8px',
  background: 'var(--bg-tertiary-themed)',
  border: '1px solid var(--content-warning-themed)',
  borderRadius: 4,
  fontSize: 12,
}

// 描画クラッシュ時も日本語のエラー表示が残るよう、エラー境界で包んで公開します。
export default withErrorBoundary(SplitLauncherPanel, PanelErrorFallback)
