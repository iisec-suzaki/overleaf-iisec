/**
 * 日本語原文と英語版 .tex を「横並び」で編集するための第 3 パネルです。
 *
 * settings.defaults.js の mainEditorLayoutPanels（Overleaf 公式のエディタ横
 * スロット）から登録され、エディター・PDF の右にもう 1 列を作ります。
 *
 * 第 2 版では、左（メインエディター）と同じ編集環境を目標に次の機能を備えます:
 * - タブバー: メインエディターのタブ（.editor-file-tab 系スタイル）と同じ見た目で、
 *   複数の .tex を同時に開き切り替えられます。タブ構成はプロジェクト単位で
 *   localStorage に記憶され、再読み込み後も復元されます。
 * - 各タブは独立した CodeMirror（CM6）インスタンスを持ち、編集中の状態や
 *    undo 履歴はタブを閉じるまで保持されます。
 * - 見た目・挙動は公式エディターと同じ拡張を再利用します:
 *   公式テーマ（フォント・サイズ・行間・ユーザー選択のエディターテーマ）、
 *   LaTeX 構文解釈（公式 lezer-latex）、行番号、アクティブ行、折りたたみ、
 *   検索、自動インデント、括弧の自動閉じ、行折り返し。
 * - 保存は Overleaf 本体の通常編集経路（docstore 経由の upsert）を通すため、
 *   履歴・同期・ファイルツリーが正しく更新されます。変更後は約 1.5 秒後に
 *   自動保存され、Ctrl/Cmd+S で即时保存もできます。
 *
 * 開き方:
 * - 翻訳パネルで英語版を保存すると自動でタブが開きます（jp-split:open イベント）。
 * - 左レールの「横並び表示」タブ、またはエディター ツールバーの
 *   「現在のファイルを右横へ移す」ボタンから開きます。
 * - メインエディターのタブをこのパネルへドラッグ＆ドロップでも移動できます。
 * - タブの ← ボタンで左（メインエディター）へ戻します。× で閉じます（未保存は確認）。
 *
 * 注意点: メインエディターで同じファイルを明示的に開いている間は、
 * 二重編集を防ぐためこのパネルの該当タブは読み取り専用になります。
 * （メイン側のタブは公式 closeTab の制約で、最後に 1 枚残す閉じ方はできません）
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import classNames from 'classnames'
import { Panel } from 'react-resizable-panels'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search'
import {
  foldGutter,
  indentOnInput,
  indentUnit,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
// 公式エディターと同じテーマ・LaTeX 構文拡張をそのまま流用します。
import {
  setEditorTheme,
  setOptionsTheme,
  theme as coreEditorTheme,
} from '@/features/source-editor/extensions/theme'
import {
  language as coreLanguage,
  type Metadata,
} from '@/features/source-editor/extensions/language'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import { useActiveEditorTheme } from '@/shared/hooks/use-active-editor-theme'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { getJSON, putJSON } from '@/infrastructure/fetch-json'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import withErrorBoundary from '@/infrastructure/error-boundary'
import type { FallbackProps } from 'react-error-boundary'
import MaterialIcon from '@/shared/components/material-icon'
// メインエディターのタブ（公式 TabsProvider）と相互にやり取りするため使用。
import {
  TAB_TRANSFER_TYPE,
  useTabsContext,
} from '@/features/ide-react/context/tabs-context'
// 公式のエディター ツールバー（太字・イタリック等の書式ボタン列）を
// このパネルの CodeMirror にも付けるために使用します。
import { toolbarPanel } from '@/features/source-editor/extensions/toolbar/toolbar-panel'
import {
  CodeMirrorStateContext,
  CodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { CodeMirrorToolbar } from '@/features/source-editor/components/codemirror-toolbar'
// 公式ツールバーが要求する Review 系コンテキスト（変更追跡など）。
import { ReviewPanelProviders } from '@/features/review-panel/context/review-panel-providers'
import { collectTexDocs } from './tex-docs'

/** タブ 1 枚ぶんの状態（CodeMirror インスタンス込み）です。 */
type SplitTab = {
  view: EditorView
  saveTimer?: ReturnType<typeof setTimeout>
}

/**
 * パネル共通の簡易エラー境界表示です（公式既定値は空要素のため日本語で代替）。
 */
function PanelErrorFallback({ error }: FallbackProps) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-primary-themed)',
        color: 'var(--content-primary-themed)',
      }}
    >
      <strong>横並び表示パネルの表示に失敗しました</strong>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          background: 'var(--bg-secondary-themed)',
          padding: 8,
          border: '1px solid var(--border-primary-themed)',
          borderRadius: 4,
          marginTop: 6,
        }}
      >
        {String((error as Error)?.message || error)}
      </pre>
    </div>
  )
}

/**
 * mainEditorLayoutPanels のスロットから呼ばれる既定コンポーネントです。
 * タブが 0 枚のあいだは何も描画しません（列そのものが消える）。
 */
function SplitFilePanel({ order }: { order?: number }) {
  const { projectId } = useProjectContext()
  const editorManager = useEditorManagerContext()
  const { eventEmitter } = useIdeReactContext()
  const { fileTreeData } = useFileTreeData()
  const { userSettings } = useUserSettingsContext()
  const activeOverallTheme = useActiveOverallTheme()
  const editorThemeId = useActiveEditorTheme()
  // メインタブバー（公式）の開閉を操作するためのコンテキスト。
  const { tabs: mainTabs, closeTab: closeMainTab } = useTabsContext()

  const projectPath = `/project/${projectId}/local-llm`
  const storageKey = `jp-split-docs:${projectId}`
  const legacyStorageKey = `jp-split-doc:${projectId}`

  // 開いているタブ（docId の並び順）と、そのうちアクティブな 1 枚。
  const [openDocIds, setOpenDocIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) return JSON.parse(raw) as string[]
      // 旧バージョン（単一ファイル）の設定があれば 1 枚として引き継ぎます。
      const legacy = localStorage.getItem(legacyStorageKey)
      return legacy ? [legacy] : []
    } catch {
      return []
    }
  })
  const [activeDocId, setActiveDocId] = useState<string>(
    () => (localStorage.getItem(`${storageKey}:active`) || '') as string
  )
  // docId ごと表示状態（読み込み中/エラー/未保存/通知）。タブ描画に使用します。
  const [meta, setMeta] = useState<
    Record<string, { loading?: boolean; error?: string; dirty?: boolean; notice?: string }>
  >({})
  // メインタブをここにドラッグしている間だけ強調表示するための状態。
  const [dropActive, setDropActive] = useState(false)
  // タブ毎のエディタービュー（公式ツールバーをコンテキスト経由で
  // マウントするための React 状態。tabsRef とは別に保持します）。
  const [cmViews, setCmViews] = useState<Record<string, EditorView>>({})

  const tabsRef = useRef<Map<string, SplitTab>>(new Map())
  const hostRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const saveRef = useRef<(docId?: string) => void>(() => {})

  const texDocs = useMemo(
    () => collectTexDocs(fileTreeData as unknown),
    [fileTreeData]
  )
  const docLabel = useCallback(
    (docId: string) => texDocs.find(doc => doc.id === docId)?.path || docId,
    [texDocs]
  )

  const persist = useCallback(
    (ids: string[], active: string) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(ids))
        if (active) localStorage.setItem(`${storageKey}:active`, active)
        else localStorage.removeItem(`${storageKey}:active`)
        localStorage.removeItem(legacyStorageKey)
      } catch {
        // localStorage が使えない環境では記憶なしで進めます。
      }
    },
    [storageKey, legacyStorageKey]
  )

  const setMetaFor = useCallback(
    (docId: string, patch: Record<string, unknown>) => {
      setMeta(prev => ({ ...prev, [docId]: { ...prev[docId], ...patch } }))
    },
    []
  )

  /** この docId がメインエディターで開かれていれば読み取り専用になります。 */
  const isReadOnlyFor = useCallback(
    (docId: string) => editorManager.getCurrentDocumentId() === docId,
    [editorManager]
  )

  /** 読み取り専用フラグを全タブへ再適用します（メインタブの開閉で変化するため）。 */
  const syncEditable = useCallback(() => {
    for (const [docId, tab] of tabsRef.current.entries()) {
      const conf = (tab.view as unknown as { editableConf?: Compartment })
        .editableConf
      if (!conf) continue
      const readOnly = isReadOnlyFor(docId)
      tab.view.dispatch({
        effects: conf.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      })
    }
  }, [isReadOnlyFor])

  /** docstore から本文を読み込み、公式拡張付きの CodeMirror を生成します。 */
  const createTab = useCallback(
    async (docId: string) => {
      if (tabsRef.current.has(docId)) return
      setMetaFor(docId, { loading: true, error: undefined })
      let content: string
      try {
        const result = await getJSON<{ content: string }>(
          `${projectPath}/doc-content?doc_id=${encodeURIComponent(docId)}`
        )
        content = result.content
      } catch (error) {
        setMetaFor(docId, {
          loading: false,
          error:
            (error as { data?: { detail?: string } })?.data?.detail ||
            'ファイルを読み込めませんでした。',
        })
        return
      }

      const host = hostRefs.current.get(docId)
      if (!host) {
        // タブを閉じられると同時に読み込みが終わったケース。握りつぶします。
        return
      }

      const readOnly = isReadOnlyFor(docId)
      const editableConf = new Compartment()
      // 公式 language() が要求するメタデータ（補完・参照検索用）は、この panel
      // では使わないので空のスタブを渡します（構文解釈には影響しません）。
      const metadataStub = {
        labels: new Set<string>(),
        packageNames: new Set<string>(),
        commands: [],
        referenceKeys: new Set<string>(),
        searchLocalReferences: async () => [],
        fileTreeData: fileTreeData as never,
      } as unknown as Metadata
      const docName = docLabel(docId) || 'document.tex'

      const view = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions: [
            // ---- 公式エディターと同じテーマ（フォント/サイズ/行間/配色） ----
            coreEditorTheme({
              fontSize: userSettings.fontSize,
              fontFamily: userSettings.fontFamily,
              lineHeight: userSettings.lineHeight,
              activeOverallTheme,
            }),
            // ---- 公式の LaTeX 構文解釈（lezer-latex を動的読み込み） ----
            coreLanguage(docName, metadataStub, { syntaxValidation: false }),
            // ---- 標準的な編集環境 ----
            lineNumbers(),
            highlightActiveLineGutter(),
            foldGutter(),
            drawSelection(),
            highlightActiveLine(),
            history(),
            indentOnInput(),
            indentUnit.of('    '),
            closeBrackets(),
            EditorView.lineWrapping,
            // 公式と同じ書式ツールバー（太字/イタリック等）を上部パネルに。
            toolbarPanel(),
            search({ top: true }),
            highlightSelectionMatches(),
            editableConf.of([
              EditorState.readOnly.of(readOnly),
              EditorView.editable.of(!readOnly),
            ]),
            keymap.of([
              {
                // Ctrl/Cmd+S で即保存（docId はクロージャーで固定）。
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  saveRef.current(docId)
                  return true
                },
              },
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of(update => {
              if (!update.docChanged) return
              setMetaFor(docId, { dirty: true })
              // メインエディターと同様の自動保存（約 1.5 秒の猶予でまとめて 1 回）。
              const tab = tabsRef.current.get(docId)
              if (tab) {
                if (tab.saveTimer) clearTimeout(tab.saveTimer)
                tab.saveTimer = setTimeout(() => saveRef.current(docId), 1500)
              }
            }),
          ],
        }),
        parent: host,
      })
      // 読み取り専用の再適用に使えるよう、Compartment をインスタンスへ添えます。
      ;(view as unknown as { editableConf: Compartment }).editableConf =
        editableConf

      // ユーザー選択のエディター配色テーマ（例: monokai）を本体と同じものに。
      void (async () => {
        try {
          view.dispatch(await setEditorTheme(editorThemeId))
        } catch {
          // テーマ読み込み失敗時は無地テーマのまま進めます。
        }
      })()

      tabsRef.current.set(docId, { view })
      setCmViews(prev => ({ ...prev, [docId]: view }))
      setMetaFor(docId, { loading: false, dirty: false })
    },
    // userSettings/fileTreeData は生成時点の設定として読みます（変更は effect で反映）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectPath, isReadOnlyFor, docLabel, fileTreeData]
  )

  /** タブを開く（既に出していればアクティブにするだけ）。 */
  const openTab = useCallback(
    (docId: string) => {
      if (!docId) return
      const ids = openDocIds.includes(docId) ? openDocIds : [...openDocIds, docId]
      setActiveDocId(docId)
      setOpenDocIds(ids)
      persist(ids, docId)
      // CodeMirror 本体は、host div（render 後）を ref で受け取ってから生成します。
    },
    [openDocIds, persist]
  )

  /** タブを閉じる（未保存なら確認し、CodeMirror を解体します）。 */
  const closeTab = useCallback(
    (docId: string, force = false) => {
      if (
        !force &&
        meta[docId]?.dirty &&
        !window.confirm('未保存の変更があります。閉じてよろしいですか？')
      ) {
        return
      }
      const tab = tabsRef.current.get(docId)
      if (tab) {
        if (tab.saveTimer) clearTimeout(tab.saveTimer)
        tab.view.destroy()
        tabsRef.current.delete(docId)
      }
      const ids = openDocIds.filter(id => id !== docId)
      const nextActive = activeDocId === docId ? ids[ids.length - 1] || '' : activeDocId
      setOpenDocIds(ids)
      setActiveDocId(nextActive)
      persist(ids, nextActive)
      setMeta(prev => {
        const next = { ...prev }
        delete next[docId]
        return next
      })
      setCmViews(prev => {
        const next = { ...prev }
        delete next[docId]
        return next
      })
    },
    [activeDocId, meta, openDocIds, persist]
  )

  const closeAllTabs = useCallback(() => {
    for (const [, tab] of tabsRef.current.entries()) {
      if (tab.saveTimer) clearTimeout(tab.saveTimer)
      tab.view.destroy()
    }
    tabsRef.current.clear()
    setCmViews({})
    setOpenDocIds([])
    setActiveDocId('')
    setMeta({})
    persist([], '')
  }, [persist])

  /**
   * このタブを左（メインエディター）へ移します。未保存分を保存してから
   * メイン側で開き直し、こちらのタブは確認なしで閉じます。
   */
  const moveTabToLeft = useCallback(
    async (docId: string) => {
      if (meta[docId]?.dirty) await save(docId)
      try {
        await editorManager.openDocWithId(docId)
      } catch {
        // 開けなかった場合もタブは維持します（エラーは次回操作で表面化）。
        return
      }
      closeTab(docId, true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorManager, closeTab, meta]
  )

  /**
   * メインタブバーからこのパネルへタブをドラッグして落としました。
   * 右側で開き、メイン側のタブは（2 枚以上あるときだけ）閉じます。
   */
  const onRootDrop = useCallback(
    (event: React.DragEvent) => {
      const docId = event.dataTransfer.getData(TAB_TRANSFER_TYPE)
      setDropActive(false)
      if (!docId) return
      event.preventDefault()
      openTab(docId)
      const inMain = mainTabs.some(tab => tab.id === docId)
      // 公式 closeTab は最後の 1 枚を閉じない仕様です（その場合は読み取り専用に）。
      if (inMain && mainTabs.length > 1) closeMainTab(docId)
    },
    [closeMainTab, mainTabs, openTab]
  )

  /** ドラッグ中かどうか（TAB_TRANSFER_TYPE のときだけ受け入れます）。 */
  const acceptsTabDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes(TAB_TRANSFER_TYPE)

  // 翻訳パネル（保存時）などからの「開いて」要求を受け取ります。
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string }>).detail
      if (detail?.docId) openTab(detail.docId)
    }
    const onClose = () => closeAllTabs()
    window.addEventListener('jp-split:open', onOpen)
    window.addEventListener('jp-split:close', onClose)
    return () => {
      window.removeEventListener('jp-split:open', onOpen)
      window.removeEventListener('jp-split:close', onClose)
    }
  }, [openTab, closeAllTabs])

  // メインエディターでタブが閉じられたら、こちらの読み取り専用も解きます。
  useEffect(() => {
    const handler = () => syncEditable()
    eventEmitter.on('document:closed', handler)
    return () => eventEmitter.off('document:closed', handler)
  }, [eventEmitter, syncEditable])

  // 保存関数（docstore upsert 経路）。タブ毎の docId に対して動作します。
  const save = useCallback(
    async (docId?: string) => {
      const target = docId || activeDocId
      const tab = target ? tabsRef.current.get(target) : undefined
      if (!tab || !target || isReadOnlyFor(target)) return
      const timer = tab.saveTimer
      if (timer) {
        clearTimeout(timer)
        tab.saveTimer = undefined
      }
      try {
        await putJSON(`${projectPath}/doc-content`, {
          body: { doc_id: target, content: tab.view.state.doc.toString() },
        })
        setMetaFor(target, { dirty: false, notice: '保存しました（履歴に反映済み）。' })
      } catch (error) {
        setMetaFor(target, {
          error:
            (error as { data?: { detail?: string }; message?: string })?.data
              ?.detail ||
            (error as { message?: string })?.message ||
            '保存に失敗しました。',
        })
      }
    },
    [activeDocId, isReadOnlyFor, projectPath, setMetaFor]
  )
  saveRef.current = save

  // 設定画面でフォント・サイズ・行間が変わったら、全タブへ即時反映します。
  useEffect(() => {
    for (const [, tab] of tabsRef.current.entries()) {
      tab.view.dispatch(
        setOptionsTheme({
          fontSize: userSettings.fontSize,
          fontFamily: userSettings.fontFamily,
          lineHeight: userSettings.lineHeight,
          activeOverallTheme,
        })
      )
    }
  }, [
    userSettings.fontSize,
    userSettings.fontFamily,
    userSettings.lineHeight,
    activeOverallTheme,
  ])

  // 非表示（display:none）の host に作成した CodeMirror は、アクティブに
  // なった時点でレイアウトを再計測させないと表示がズレることがあります。
  useEffect(() => {
    const view = cmViews[activeDocId]
    if (!view) return
    const raf = requestAnimationFrame(() => view.requestMeasure())
    return () => cancelAnimationFrame(raf)
  }, [activeDocId, cmViews])

  if (openDocIds.length === 0) return null

  // ツールバーを取り付ける対象（アクティブタブのビュー）。
  const activeView = cmViews[activeDocId]

  return (
    <>
      <HorizontalResizeHandle id="jp-split-file-panel-handle" />
      <Panel
        id="jp-split-file-panel"
        order={order ?? 3}
        defaultSize={35}
        minSize={12}
        collapsible
        className="jp-split-file-panel"
      >
        <div
          style={{
            ...rootStyle,
            // メインタブのドラッグ中は内側枠線で受け入れ先を示します。
            boxShadow: dropActive
              ? 'inset 0 0 0 2px var(--content-info-themed)'
              : undefined,
          }}
          onDragOver={event => {
            if (acceptsTabDrag(event)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropActive(true)
            }
          }}
          onDragLeave={event => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return
            setDropActive(false)
          }}
          onDrop={onRootDrop}
          // クリック時に読み取り専用判定を再評価します（左がタブを閉じずに
          // 切り替えだけした場合でも、次回操作で即座に編集可へ戻します）。
          onMouseDown={() => syncEditable()}
        >
          {/* メインタブと同じ .editor-file-tab 系のスタイルを使ったタブバー */}
          <div className="editor-tabs-container">
            <div className="editor-tabs-row" role="tablist">
              {openDocIds.map(docId => {
                const active = docId === activeDocId
                return (
                  <div
                    key={docId}
                    role="tab"
                    aria-selected={active}
                    className={classNames('editor-file-tab', {
                      'tab-selected': active,
                    })}
                    onClick={() => {
                      setActiveDocId(docId)
                      persist(openDocIds, docId)
                      syncEditable()
                    }}
                  >
                    <div className="editor-file-tab-content">
                      <span className="editor-file-tab-icon">
                        <MaterialIcon type="description" size="2x" />
                      </span>
                      <div className="editor-file-tab-path" title={docLabel(docId)}>
                        &lrm;{docLabel(docId)}
                        {meta[docId]?.dirty ? ' •' : ''}
                      </div>
                      <div className="editor-file-tab-action">
                        <button
                          type="button"
                          className="editor-file-tab-close-action"
                          aria-label="このタブを左のエディターへ移す"
                          title="このタブを左のエディターへ移す"
                          onClick={event => {
                            event.stopPropagation()
                            void moveTabToLeft(docId)
                          }}
                        >
                          <MaterialIcon type="arrow_back_ios_new" size="2x" />
                        </button>
                        <button
                          type="button"
                          className="editor-file-tab-close-action"
                          aria-label="タブを閉じる"
                          onClick={event => {
                            event.stopPropagation()
                            closeTab(docId)
                          }}
                        >
                          <MaterialIcon type="close" size="2x" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {openDocIds.map(docId => {
            const m = meta[docId] || {}
            const active = docId === activeDocId
            if (!active) return null
            return (
              <div key={`notice-${docId}`}>
                {isReadOnlyFor(docId) && (
                  <div style={noticeStyle}>
                    同じファイルがメインエディターで開かれているため、このタブは読み取り専用です。
                  </div>
                )}
                {m.loading && <div style={noticeStyle}>読み込み中…</div>}
                {m.error && (
                  <div role="alert" className="alert alert-danger" style={{ margin: 6 }}>
                    {m.error}
                  </div>
                )}
                {m.notice && !m.error && (
                  <div role="status" style={noticeStyle}>
                    {m.notice}
                  </div>
                )}
              </div>
            )
          })}
          {/* 各タブのエディター本体。アクティブな 1 枚だけ表示します（状態は保持）。
              host div は常に同じ位置・同じ型で描画します（ツールバー用の
              Provider で包み替えると React が div を作り直し、EditorView が
              外れた DOM に残って白画面になるため）。 */}
          <div style={editorHostStyle}>
            {openDocIds.map(docId => (
              <div
                key={`host-${docId}`}
                ref={node => {
                  if (node) {
                    hostRefs.current.set(docId, node)
                    const existing = tabsRef.current.get(docId)
                    if (existing && existing.view.dom.parentNode !== node) {
                      // host が作り直された場合、既存の EditorView を
                      // 新しい DOM へ付け替えて白画面を自己復旧します。
                      node.appendChild(existing.view.dom)
                    }
                    // host div が揃った時点で未作成ならタブ（CodeMirror）を作ります。
                    if (
                      !tabsRef.current.has(docId) &&
                      !meta[docId]?.loading
                    ) {
                      setTimeout(() => void createTab(docId), 0)
                    }
                  } else {
                    hostRefs.current.delete(docId)
                  }
                }}
                style={{
                  height: '100%',
                  display: docId === activeDocId ? 'block' : 'none',
                }}
              />
            ))}
          </div>
          {/* 公式ツールバー（太字等の書式ボタン列）。本体はアクティブビューの
              CM パネル DOM へのポータルなので、この JSX 自体は描画しません。
              host とは別の兄弟要素に置くことで host の再生成を防ぎます。
              公式と同じ順序（CodeMirror コンテキスト → Review 系）で包みます。 */}
          {activeView && (
            <CodeMirrorStateContext.Provider value={activeView.state}>
              <CodeMirrorViewContext.Provider value={activeView}>
                <ReviewPanelProviders>
                  <CodeMirrorToolbar />
                </ReviewPanelProviders>
              </CodeMirrorViewContext.Provider>
            </CodeMirrorStateContext.Provider>
          )}
        </div>
      </Panel>
    </>
  )
}

// ---- パネルの装飾用スタイル --------------------------------------------------

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--bg-primary-themed)',
  // レールの他パネルと同じテーマ変数に追従させます。
  color: 'var(--content-primary-themed)',
}

const noticeStyle: CSSProperties = {
  margin: '6px 10px 0',
  padding: '6px 8px',
  background: 'var(--bg-tertiary-themed)',
  border: '1px solid var(--content-warning-themed)',
  borderRadius: 4,
  fontSize: 12,
}

const editorHostStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
}

// 描画クラッシュ時も日本語のエラー表示が残るよう、エラー境界で包んで公開します。
export default withErrorBoundary(SplitFilePanel, PanelErrorFallback)
