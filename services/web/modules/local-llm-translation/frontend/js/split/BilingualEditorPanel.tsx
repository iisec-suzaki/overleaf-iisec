/**
 * 公式の追加パネルに、別の .tex を開いて比較・編集する。
 * 原文・PDF・MCP の既存経路は維持し、保存は読み込み時の版に対してだけ行う。
 * 他の編集者や MCP が先に更新した場合は 409 を表示し、ローカルの変更を残す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from 'react-resizable-panels'
import classNames from 'classnames'
import MaterialIcon from '@/shared/components/material-icon'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { foldGutter, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  theme,
  setEditorTheme,
  setOptionsTheme,
} from '@/features/source-editor/extensions/theme'
import {
  language,
  type Metadata,
} from '@/features/source-editor/extensions/language'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { useActiveEditorTheme } from '@/shared/hooks/use-active-editor-theme'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import { getJSON, putJSON } from '@/infrastructure/fetch-json'
import { collectTexDocs } from './tex-docs'
import {
  TAB_TRANSFER_TYPE,
  useTabsContext,
} from '@/features/ide-react/context/tabs-context'
import {
  CodeMirrorStateContext,
  CodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import BilingualEditorToolbar from './BilingualEditorToolbar'

type Session = { id: string; view: EditorView; version: number; saved: string }
const errorMessage = (error: unknown) =>
  (error as { data?: { detail?: string }; message?: string })?.data?.detail ||
  (error as Error)?.message ||
  '処理に失敗しました。'

type TabStatus = { dirty: boolean; saving: boolean }

function DocumentEditor({
  docId,
  active,
  refreshToken,
  onStatusChange,
  moving,
}: {
  docId: string
  active: boolean
  moving: boolean
  refreshToken: number
  onStatusChange: (id: string, status: TabStatus) => void
}) {
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { currentDocumentId } = useEditorOpenDocContext()
  const permissions = usePermissionsContext()
  const { userSettings } = useUserSettingsContext()
  const overallTheme = useActiveOverallTheme()
  const editorTheme = useActiveEditorTheme()
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const session = useRef<Session | null>(null)
  const savingRef = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const autoSaveBlocked = useRef(false)
  const saveRef = useRef<() => void>(() => {})
  const editable = useRef(new Compartment())
  const options = useMemo(() => collectTexDocs(fileTreeData), [fileTreeData])
  const selected = options.find(doc => doc.id === docId)
  const canEdit = Boolean(
    permissions.write && selected && currentDocumentId !== docId && !moving
  )
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  // タブごとに入力をまとめて保存する。競合・失敗後は勝手に再試行しない。
  const scheduleSave = useCallback((changed = true) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    if (changed && canEditRef.current && !autoSaveBlocked.current) {
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined
        saveRef.current()
      }, 1500)
    }
  }, [])
  const apiPath = `/project/${projectId}/local-llm/doc-content`
  const themeOptions = {
    fontSize: userSettings.fontSize,
    fontFamily: userSettings.fontFamily,
    lineHeight: userSettings.lineHeight,
    activeOverallTheme: overallTheme,
  }
  const initial = useRef({ themeOptions, editorTheme, fileTreeData })
  initial.current = { themeOptions, editorTheme, fileTreeData }

  // 誤って画面を離れても、未保存のスナップショットを無言で捨てない。
  useEffect(() => {
    if (!dirty && !saving) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, saving])

  useEffect(() => {
    if (!docId || !host.current) return
    const controller = new AbortController()
    setLoading(true)
    setEditorState(null)
    setDirty(false)
    setError('')
    setNotice('')
    autoSaveBlocked.current = false
    onStatusChange(docId, { dirty: false, saving: false })
    let view: EditorView | undefined
    getJSON<{ content: string; version: number }>(
      `${apiPath}?doc_id=${encodeURIComponent(docId)}`,
      { signal: controller.signal }
    )
      .then(async doc => {
        if (controller.signal.aborted || !host.current) return
        const data = initial.current
        const metadata: Metadata = {
          labels: new Set(),
          packageNames: new Set(),
          commands: [],
          referenceKeys: new Set(),
          searchLocalReferences: async () => ({ hits: [] }),
          fileTreeData: data.fileTreeData || {
            _id: '',
            name: '',
            docs: [],
            folders: [],
            fileRefs: [],
          },
        }
        view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: doc.content,
            extensions: [
              theme(data.themeOptions),
              language('document.tex', metadata, { syntaxValidation: false }),
              history(),
              lineNumbers(),
              foldGutter(),
              indentOnInput(),
              closeBrackets(),
              search({ top: true }),
              EditorView.lineWrapping,
              editable.current.of([
                EditorState.readOnly.of(!canEditRef.current),
                EditorView.editable.of(canEditRef.current),
              ]),
              keymap.of([
                {
                  key: 'Mod-s',
                  preventDefault: true,
                  run: () => {
                    saveRef.current()
                    return true
                  },
                },
                ...defaultKeymap,
                ...historyKeymap,
                ...searchKeymap,
                ...closeBracketsKeymap,
                indentWithTab,
              ]),
              EditorView.contentAttributes.of({
                'aria-label': '横並びエディター',
              }),
              EditorView.updateListener.of(update => {
                // 選択範囲・権限・Undo状態の変化も、公式ツールバーへ反映します。
                setEditorState(update.state)
                if (
                  update.docChanged &&
                  session.current?.view === update.view
                ) {
                  const changed =
                    update.state.doc.toString() !== session.current.saved
                  setDirty(changed)
                  // 親の閉じる操作は、React の描画を待たず最新の未保存状態を見る。
                  onStatusChange(docId, {
                    dirty: changed,
                    saving: savingRef.current,
                  })
                  scheduleSave(changed)
                }
              }),
            ],
          }),
        })
        session.current = {
          id: docId,
          view,
          version: doc.version,
          saved: doc.content,
        }
        setEditorState(view.state)
        const spec = await setEditorTheme(data.editorTheme)
        if (!controller.signal.aborted) view.dispatch(spec)
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      window.clearTimeout(saveTimer.current)
      if (session.current?.view === view) session.current = null
      view?.destroy()
    }
  }, [apiPath, docId, reload, refreshToken, onStatusChange, scheduleSave])

  // メイン側で同じ文書を開いた場合や権限変更を、既存のビューにも直ちに反映する。
  useEffect(() => {
    session.current?.view.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(!canEdit),
        EditorView.editable.of(canEdit),
      ]),
    })
    const current = session.current
    scheduleSave(
      Boolean(
        canEdit &&
        current &&
        current.view.state.doc.toString() !== current.saved
      )
    )
  }, [canEdit, scheduleSave])
  useEffect(() => {
    session.current?.view.dispatch(setOptionsTheme(themeOptions))
  }, [
    userSettings.fontSize,
    userSettings.fontFamily,
    userSettings.lineHeight,
    overallTheme,
  ])
  useEffect(() => {
    let stale = false
    const current = session.current
    if (current)
      void setEditorTheme(editorTheme).then(spec => {
        if (!stale && session.current === current) current.view.dispatch(spec)
      })
    return () => {
      stale = true
    }
  }, [editorTheme])

  // 非表示だったタブは、選択時にサイズを測り直す。ビューと undo 履歴は破棄しない。
  useEffect(() => {
    const current = session.current
    if (!active || !current) return
    const frame = window.requestAnimationFrame(() => {
      if (session.current === current) current.view.requestMeasure()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active])

  const save = useCallback(async () => {
    const current = session.current
    if (!current || !canEditRef.current || savingRef.current) return
    const content = current.view.state.doc.toString()
    window.clearTimeout(saveTimer.current)
    autoSaveBlocked.current = false
    savingRef.current = true
    onStatusChange(docId, { dirty: content !== current.saved, saving: true })
    setSaving(true)
    setError('')
    setNotice('')
    try {
      // 版は本文と同じ応答から採り、保存成功時だけ更新する。
      const result = await putJSON<{ version: number }>(apiPath, {
        body: { doc_id: current.id, content, version: current.version },
      })
      if (session.current === current) {
        current.version = result.version
        current.saved = content
        setDirty(current.view.state.doc.toString() !== content)
        setNotice('保存しました。')
      }
    } catch (failure) {
      autoSaveBlocked.current = true
      if (session.current === current) setError(errorMessage(failure))
    } finally {
      savingRef.current = false
      setSaving(false)
      if (session.current === current) {
        const changed = current.view.state.doc.toString() !== current.saved
        onStatusChange(docId, { dirty: changed, saving: false })
        // 保存応答を待っている間に追加入力があった場合も、同じ版で二重送信しない。
        scheduleSave(changed)
      }
    }
  }, [apiPath, docId, onStatusChange, scheduleSave])
  saveRef.current = save
  const allowDiscard = () =>
    !saving &&
    (!dirty ||
      window.confirm(
        '横並び側の未保存の変更を破棄しますか？必要な内容は先にコピーしてください。'
      ))

  return (
    <div
      role="tabpanel"
      id={`bilingual-panel-${docId}`}
      aria-labelledby={`bilingual-tab-${docId}`}
      hidden={!active}
      style={{
        height: '100%',
        minHeight: 0,
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '0 12px 12px',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canEdit || !dirty || saving || loading}
          onClick={save}
        >
          {saving ? '保存中…' : '横並びの変更を保存'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving || loading}
          onClick={() => {
            if (allowDiscard()) setReload(value => value + 1)
          }}
        >
          再読込
        </button>
        <span role="status">
          {loading
            ? '読み込み中…'
            : dirty
              ? '未保存の変更があります。'
              : notice}
        </span>
      </div>
      {currentDocumentId === docId && (
        <p style={{ padding: '0 12px' }}>
          同じ文書をメインで開いているため、横並び側は読み取り専用です。
        </p>
      )}
      {!permissions.write && (
        <p style={{ padding: '0 12px' }}>閲覧専用です。</p>
      )}
      {error && (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      )}
      {active && editorState && session.current && (
        <CodeMirrorStateContext.Provider value={editorState}>
          <CodeMirrorViewContext.Provider value={session.current.view}>
            <BilingualEditorToolbar docId={docId} />
          </CodeMirrorViewContext.Provider>
        </CodeMirrorStateContext.Provider>
      )}
      <div ref={host} style={{ flex: 1, minHeight: 0, overflow: 'auto' }} />
    </div>
  )
}

/** タブ構成だけを記憶する。未保存の本文は localStorage へ複製しない。 */
function restoreTabs(key: string): { ids: string[]; active: string } {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null')
    const ids = Array.isArray(stored?.ids)
      ? [
          ...new Set<string>(
            stored.ids.filter(
              (id: unknown) => typeof id === 'string' && id.length > 0
            )
          ),
        ]
      : []
    return {
      ids,
      active: ids.includes(stored?.active) ? stored.active : ids[0] || '',
    }
  } catch {
    return { ids: [], active: '' }
  }
}

export default function BilingualEditorPanel({ order }: { order?: number }) {
  const { projectId } = useProjectContext()
  return <ProjectBilingualEditor key={projectId} order={order} />
}

function ProjectBilingualEditor({ order }: { order?: number }) {
  const {
    tabs: mainTabs,
    closeTab: closeMainTab,
    openTab: openMainTab,
  } = useTabsContext()
  const [moving, setMoving] = useState('')
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { currentDocumentId } = useEditorOpenDocContext()
  const options = useMemo(() => collectTexDocs(fileTreeData), [fileTreeData])
  const storageKey = `bilingual-editor-tabs:${projectId}`
  const [initial] = useState(() => restoreTabs(storageKey))
  const [ids, setIds] = useState(initial.ids)
  const [active, setActive] = useState(initial.active)
  useEffect(() => {
    if (!ids.includes(active)) setActive(ids[0] || '')
  }, [ids, active])
  const [statuses, setStatuses] = useState<Record<string, TabStatus>>({})
  const [refresh, setRefresh] = useState<Record<string, number>>({})
  const [notice, setNotice] = useState('')
  const statusRef = useRef<Record<string, TabStatus>>({})
  const onStatusChange = useCallback((id: string, status: TabStatus) => {
    const previous = statusRef.current[id]
    statusRef.current[id] = status
    if (previous?.dirty !== status.dirty || previous?.saving !== status.saving)
      setStatuses(current => ({ ...current, [id]: status }))
  }, [])

  useEffect(() => {
    try {
      if (ids.length)
        localStorage.setItem(storageKey, JSON.stringify({ ids, active }))
      else localStorage.removeItem(storageKey)
    } catch {
      /* ストレージが使えなくても、編集自体は継続する。 */
    }
  }, [storageKey, ids, active])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          docId?: string
          refresh?: boolean
          move?: boolean
        }>
      ).detail
      const current = options.find(doc => doc.id === currentDocumentId)
      const companion = current?.path.toLowerCase().endsWith('.en.tex')
        ? current.path.slice(0, -7) + '.tex'
        : current?.path.replace(/\.tex$/i, '.en.tex')
      const fallback =
        options.find(doc => doc.path.replace(/\.tex$/i, '.tex') === companion)
          ?.id ||
        options.find(doc => doc.id !== currentDocumentId)?.id ||
        currentDocumentId ||
        ''
      const target =
        typeof detail?.docId === 'string' && detail.docId
          ? detail.docId
          : ids.length
            ? active
            : fallback
      if (!target) return
      // 移動要求は同じプロジェクトの既知の.texタブに限定します。
      if (detail?.move && !options.some(doc => doc.id === target)) return
      if (
        detail?.move &&
        mainTabs.some(tab => tab.id === target) &&
        mainTabs.length > 1
      ) {
        Promise.resolve(closeMainTab(target)).catch(() =>
          setNotice(
            'メイン側のタブを閉じられませんでした。横並び側の内容は保持しています。'
          )
        )
      }
      setIds(previous =>
        previous.includes(target) ? previous : [...previous, target]
      )
      setActive(target)
      if (detail?.refresh && ids.includes(target)) {
        const state = statusRef.current[target]
        if (state?.dirty || state?.saving) {
          setNotice(
            '翻訳結果は保存されました。横並び側の編集中の内容は保持しています。必要な部分をコピーしてから再読込してください。'
          )
        } else {
          setRefresh(previous => ({
            ...previous,
            [target]: (previous[target] || 0) + 1,
          }))
          setNotice('')
        }
      }
    }
    window.addEventListener('overleaf:open-bilingual-editor', onOpen)
    return () =>
      window.removeEventListener('overleaf:open-bilingual-editor', onOpen)
  }, [options, currentDocumentId, ids, active, mainTabs, closeMainTab])

  const label = (id: string) => options.find(doc => doc.id === id)?.path || id
  const canClose = (targets: string[]) => {
    if (targets.some(id => statusRef.current[id]?.saving)) return false
    return (
      !targets.some(id => statusRef.current[id]?.dirty) ||
      window.confirm(
        '横並び側の未保存の変更を破棄しますか？必要な内容は先にコピーしてください。'
      )
    )
  }
  const closeTab = (id: string) => {
    if (!canClose([id])) return
    const remaining = ids.filter(item => item !== id)
    delete statusRef.current[id]
    setStatuses(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    // メインで開く非同期処理中に追加された別タブを、古い配列で消さないようにします。
    setIds(current => current.filter(item => item !== id))
    setActive(current => current === id ? remaining[0] || '' : current)
    setNotice('')
  }
  const moveLeft = async (id: string) => {
    if (
      moving ||
      statusRef.current[id]?.dirty ||
      statusRef.current[id]?.saving
    ) {
      setNotice('未保存の変更を保存してから、左のエディターへ移してください。')
      return
    }
    setMoving(id)
    try {
      // openTabの完了までは右側の編集を止め、成功するまでタブを残します。
      await openMainTab(id)
      if (statusRef.current[id]?.dirty || statusRef.current[id]?.saving) {
        setNotice(
          '横並び側の変更を保持しました。メインで別の文書を開き、変更を保存してから移動してください。'
        )
        return
      }
      closeTab(id)
    } catch {
      setNotice(
        '左のエディターで開けませんでした。横並び側のタブは保持しています。'
      )
    } finally {
      setMoving('')
    }
  }
  if (!ids.length) return null
  return (
    <>
      <HorizontalResizeHandle id="bilingual-editor-handle" />
      <Panel
        id="bilingual-editor-panel"
        order={order ?? 3}
        defaultSize={35}
        minSize={15}
        tagName="section"
        aria-label="日英の横並び編集"
      >
        <div
          onDragOver={event => {
            if (
              Array.from(event.dataTransfer.types).includes(TAB_TRANSFER_TYPE)
            ) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={event => {
            const id = event.dataTransfer.getData(TAB_TRANSFER_TYPE)
            if (
              !mainTabs.some(tab => tab.id === id) ||
              !options.some(doc => doc.id === id)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            window.dispatchEvent(
              new CustomEvent('overleaf:open-bilingual-editor', {
                detail: { docId: id, move: true },
              })
            )
          }}
          style={{
            height: '100%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            color: 'var(--content-primary-themed)',
            background: 'var(--bg-primary-themed)',
          }}
        >
          <header
            style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            <label style={{ flex: 1 }}>
              横並びで開く .tex
              <select
                aria-label="横並びで開く .tex"
                className="form-select"
                value={active}
                onChange={event => {
                  const id = event.target.value
                  setIds(previous =>
                    previous.includes(id) ? previous : [...previous, id]
                  )
                  setActive(id)
                  setNotice('')
                }}
              >
                {!options.some(doc => doc.id === active) && (
                  <option value={active}>{label(active)}</option>
                )}
                {options.map(doc => (
                  <option key={doc.id} value={doc.id}>
                    {doc.path}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Object.values(statuses).some(status => status.saving)}
              onClick={() => {
                if (canClose(ids)) {
                  setIds([])
                  setActive('')
                  statusRef.current = {}
                  setStatuses({})
                  setNotice('')
                }
              }}
            >
              横並びを閉じる
            </button>
          </header>
          {/* メインタブと同じ .editor-file-tab 系のスタイルを使ったタブバー
              （伊藤さん試作 port/complete-sync c9e89d9482 の SplitFilePanel 準拠。
              クラスは pages/editor/tabs.scss がエディターページ全体に効く） */}
          <div className="editor-tabs-container">
            <div className="editor-tabs-row" role="tablist" aria-label="横並びの文書">
              {ids.map(id => (
                <div
                  key={id}
                  role="tab"
                  id={`bilingual-tab-${id}`}
                  aria-controls={`bilingual-panel-${id}`}
                  aria-selected={active === id}
                  aria-label={label(id)}
                  className={classNames('editor-file-tab', {
                    'tab-selected': active === id,
                  })}
                  onClick={() => {
                    setActive(id)
                    setNotice('')
                  }}
                >
                  <div className="editor-file-tab-content">
                    <span className="editor-file-tab-icon">
                      <MaterialIcon type="description" size="2x" />
                    </span>
                    <div className="editor-file-tab-path" title={label(id)}>
                      &lrm;{label(id)}
                      {statuses[id]?.dirty ? ' •' : ''}
                    </div>
                    <div className="editor-file-tab-action">
                      <button
                        type="button"
                        className="editor-file-tab-close-action"
                        aria-label={`${label(id)} を左のエディターへ移す`}
                        title="このタブを左のエディターへ移す"
                        disabled={Boolean(moving) || statuses[id]?.saving}
                        onClick={event => {
                          event.stopPropagation()
                          void moveLeft(id)
                        }}
                      >
                        <MaterialIcon type="arrow_back_ios_new" size="2x" />
                      </button>
                      <button
                        type="button"
                        className="editor-file-tab-close-action"
                        aria-label={`${label(id)} のタブを閉じる`}
                        disabled={statuses[id]?.saving}
                        onClick={event => {
                          event.stopPropagation()
                          closeTab(id)
                        }}
                      >
                        <MaterialIcon type="close" size="2x" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {notice && (
            <p role="status" className="px-3">
              {notice}
            </p>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            {ids.map(id => (
              <DocumentEditor
                key={id}
                docId={id}
                active={active === id}
                moving={moving === id}
                refreshToken={refresh[id] || 0}
                onStatusChange={onStatusChange}
              />
            ))}
          </div>
        </div>
      </Panel>
    </>
  )
}
