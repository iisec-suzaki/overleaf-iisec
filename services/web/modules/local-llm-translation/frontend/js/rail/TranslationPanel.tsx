/**
 * 左レール（セクション）の「英語翻訳」パネルです。
 *
 * もとはソース編集ツールバーのボタン + モーダルだった TranslationToolbar を、
 * クラウド版 Overleaf のアシスタントと同じ「左レールのタブパネル」へ移した
 * ものです。CodeMirror へのアクセスは CodeMirrorBridge（同じモジュール）経由
 * で行い、パネル自体はレール側（CodeMirror コンテキストの外）にいます。
 *
 * 流れは旧パネルと同じです。
 *
 * 1. タブを開くとモデル一覧・プロジェクト設定（用語集）・翻訳専用設定を読む
 *    （接続先の選択は LLM 設定画面 /user/llm-settings の翻訳専用欄で行う。
 *    パネルには接続系 UI を置かず、現状の一行表示とリンクだけを置く）
 * 2. 「確認して翻訳」で原文スナップショットを取り、Overleaf API 経由で翻訳開始
 * 3. SSE の進捗・訳片をプレビューへ反映する
 * 4. 完了後、全文翻訳は .en.tex として保存（保存後は横並びパネルも自動で開く）、
 *    選択範囲翻訳は原文へ適用する
 *
 * 翻訳中に原文が編集された場合（canApply が false）、適用・保存を止めます。
 */
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useProjectContext } from '@/shared/context/project-context'
import { getJSON, postJSON, putJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import withErrorBoundary from '@/infrastructure/error-boundary'
import type { FallbackProps } from 'react-error-boundary'
import {
  getBridgedEditor,
  subscribeBridgedEditor,
} from '../CodeMirrorBridge'

// ---- 翻訳 API が返すデータの型定義 -----------------------------------------

type Model = { id: string; owned_by?: string }
type GlossaryTerm = { source: string; target: string }
// LLM 設定画面（/user/llm-translation-settings）が返す翻訳専用設定。
// providerId 空 = 翻訳サービス側の標準設定に従う（接続・モデル欄は無効）。
type TranslationSettings = {
  providerId: string
  model: string
  minimal: boolean
  chunkChars: number
}
// LLM 設定画面の BYO 行（/user/llm-providers 由来。秘密値は含まれない）。
// 翻訳専用欄で選んだ行のモデル一覧だけを翻訳パネルに映すために使う。
type LlmProviderRow = {
  id: string
  name: string
  providerType: 'openai' | 'anthropic' | 'openaiCompatible'
  baseUrl: string
  hasKey: boolean
  models: string[]
  completionModel: string
  enabled: boolean
}
type ProjectSettings = {
  terms: GlossaryTerm[]
  model: string | null
  context: string
  // スタイル・役割のプロンプト指示（空欄なら既定文を使う）。
  prompt_instructions?: string
  // 翻訳サービスが返す既定プロンプト文（「デフォルトに戻す」表示用）。
  default_prompt_instructions?: string
}
// 翻訳完了イベント（complete）の本文。結果テキストと使用情報を運びます。
// failed_chunks が空でなければ、失敗したチャンクは原文保持のまま保存されます。
type TranslationReply = {
  text: string
  model: string
  chunks: number
  protected_tokens: number
  failed_chunks?: number[]
}
// SSE で届くイベントの連合型（進捗・訳片・チャンク完了・完了・エラー）。
type TranslationStreamEvent =
  | { type: 'progress'; phase: string; chunk: number; total: number; message: string }
  | { type: 'delta'; chunk: number; text: string }
  | { type: 'chunk_complete'; chunk: number; text: string; ok?: boolean }
  | ({ type: 'complete' } & TranslationReply)
  | { type: 'error'; detail: string }
// 翻訳対象の指定方法（選択範囲 / 現在のファイル全体）。
type Target = 'selection' | 'file'
// 翻訳開始時の文書状態の照合用スナップショット。
// 翻訳完了時に現在の内容と違う場合、結果の適用・保存を止めます。
type Snapshot = {
  text: string
  document: string
  sourceDocId: string
  from: number
  to: number
  target: Target
}

/** API エラーから日本語のメッセージを取り出します（detail 優先）。 */
function getErrorMessage(error: unknown): string {
  const candidate = error as { data?: { detail?: string }; message?: string }
  return candidate?.data?.detail || candidate?.message || '処理に失敗しました。'
}

// 保護マーカーの語頭（バックエンドの QZPROTECTED000000XZQ と同一語）。
const MARKER_WORD = 'QZPROTECTED'

/**
 * 生成途中の訳片の仮表示用です。保護マーカーを「…」に伏せます。
 * マーカーが delta で分割された場合（例: QZPROTECTED00 + 00XZQ）も伏せきれるよう、
 * 完全形・数字まで途切れ・語頭の途中表記（QZPR…）の順に末尾の断片を隠します。
 */
function maskPartialMarkers(text: string): string {
  // 完全なマーカーを「…」に置換します。
  let masked = text.replace(/QZPROTECTED\d{0,6}XZQ/g, '…')
  // 末尾でマーカーの途中まで届いた分（数字や XZQ がまだ来ていない）も隠します。
  masked = masked.replace(/QZPROTECTED\d*(?:X(?:Z(?:Q)?)?)?$/, '')
  // 末尾がちょうど「QZPROTECTED」の途中表記なら、その断片も隠します。
  for (let length = MARKER_WORD.length - 1; length >= 1; length -= 1) {
    if (MARKER_WORD.startsWith(masked.slice(-length))) {
      masked = masked.slice(0, -length)
      break
    }
  }
  return masked
}

/**
 * 翻訳 SSE ストリームを読み取り、イベントを onEvent に流しながら
 * 完了イベント（complete）を返します。error イベントが届いた場合は
 * その内容で throw します（原文は適用されていません）。
 */
async function streamTranslation(
  path: string,
  body: { text: string; model: string },
  signal: AbortSignal,
  onEvent: (event: TranslationStreamEvent) => void
): Promise<TranslationReply> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Csrf-Token': getMeta('ol-csrfToken'),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.detail || `翻訳サービスが HTTP ${response.status} を返しました。`)
  }
  if (!response.body) throw new Error('ストリーミング応答を読み取れません。')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: TranslationReply | null = null
  let streamError = ''

  const consumeEvent = (frame: string) => {
    const data = frame
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    const event = JSON.parse(data) as TranslationStreamEvent
    if (event.type === 'complete') result = event
    if (event.type === 'error') streamError = event.detail
    onEvent(event)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        consumeEvent(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
      if (done) break
    }
    if (buffer.trim()) consumeEvent(buffer)
  } finally {
    reader.releaseLock()
  }

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('翻訳ストリームが完了イベントを返しませんでした。')
  return result
}

/**
 * 英語版ファイルの横並びパネル（SplitFilePanel）を開く合図です。
 * 翻訳保存後に呼び、panel 側で doc_id を読み込んで表示します。
 */
function dispatchOpenSplitPanel(docId: string) {
  window.dispatchEvent(new CustomEvent('jp-split:open', { detail: { docId } }))
}

/**
 * パネル共通の簡易エラー境界表示です。
 * Overleaf 公式の既定フォールバックは空要素なので、原因が分かる日本語を渡します。
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

/**
 * 左レール「英語翻訳」タブのパネル本体です。
 * エディターが開いていない・ .tex 以外の場合は案内だけ表示します。
 */
function TranslationPanel() {
  const { projectId, project, updateProject } = useProjectContext()
  const editorManager = useEditorManagerContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder, dirname, findEntityByPath } = useFileTreePathContext()

  // 開いているファイルは公式の EditorManager / ファイルパスから判定します
  // （CodeMirror ブリッジが使えなくても全文翻訳は動く）。ブリッジは
  // 「選択範囲」翻訳と選択位置の取得だけに使います。
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => subscribeBridgedEditor(refresh), [])
  const editor = getBridgedEditor()
  const view = editor?.view ?? null
  const docPath = currentDocumentId ? pathInFolder(currentDocumentId) : null
  const docValue = currentDocumentId ? editorManager.getCurrentDocValue() : null
  const isTex = Boolean(
    currentDocumentId && docPath?.toLowerCase().endsWith('.tex')
  )
  const selection = view?.state.selection.main
  const hasSelection = Boolean(view && selection && !selection.empty)

  // ---- パネルの表示状態・翻訳結果などの状態値 ------------------------------
  const [target, setTarget] = useState<Target>('file')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [context, setContext] = useState('')
  const [promptInstructions, setPromptInstructions] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [completedPreview, setCompletedPreview] = useState('')
  const [partialPreview, setPartialPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<TranslationReply | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // ---- 翻訳専用設定（LLM 設定画面）の表示用状態 ------------------------------
  // 接続先の選び場所は LLM 設定画面の翻訳専用欄へ集約済み。ここでは「今どの
  // 接続先が効いているか」の一行表示と、BYO 行选择時のモデル一覧供給だけ行う。
  const [translationSettings, setTranslationSettings] =
    useState<TranslationSettings | null>(null)
  const [providerRows, setProviderRows] = useState<LlmProviderRow[]>([])
  const translationAbortRef = useRef<AbortController | null>(null)

  const projectPath = `/project/${projectId}/local-llm`

  // 結果を適用・保存できる条件: 翻訳後に対象ドキュメントが一度も編集されていないこと。
  // 「現在のファイル」翻訳は CodeMirror を経由せず docstore 側の値で照合します
  // （ブリッジ不通でも安全機能が動くため）。
  const canApply = Boolean(
    result &&
      snapshot &&
      editorManager.getCurrentDocumentId() === snapshot.sourceDocId &&
      (snapshot.target === 'file'
        ? editorManager.getCurrentDocValue() === snapshot.document
        : view && view.state.doc.toString() === snapshot.document)
  )

  // パネルが開かれた（マウントされた）時点で設定と翻訳専用設定を読み込みます。
  useEffect(() => {
    let active = true
    const loadPanel = async () => {
      setError('')
      setNotice('')
      setConsented(false)
      setTarget(hasSelection ? 'selection' : 'file')

      const [settingsResult, translationResult] = await Promise.allSettled([
        getJSON<ProjectSettings>(`${projectPath}/settings`),
        getJSON<{ ok: boolean; settings: TranslationSettings }>(
          '/user/llm-translation-settings'
        ),
      ])
      if (!active) return

      // 翻訳専用設定は翻訳に必須ではないため、取得失敗してもパネル自体は開きます
      // （その場合は標準設定チェーンで動きます）。
      let savedTranslation: TranslationSettings | null = null
      if (translationResult.status === 'fulfilled' && translationResult.value.ok) {
        savedTranslation = translationResult.value.settings
        setTranslationSettings(savedTranslation)
      }

      let savedModel: string | null = null
      if (settingsResult.status === 'fulfilled') {
        const loaded = settingsResult.value
        setTerms(loaded.terms || [])
        setContext(loaded.context || '')
        setPromptInstructions(loaded.prompt_instructions || '')
        setDefaultPrompt(loaded.default_prompt_instructions || '')
        savedModel = loaded.model
      } else {
        setError(getErrorMessage(settingsResult.reason))
      }

      // 翻訳専用欄が BYO 行を指しているときだけ行一覧を引きます
      // （BYO 無効デプロイでは 403 になるので、静かに標準へ降格します）。
      let providerList: LlmProviderRow[] = []
      if (savedTranslation?.providerId) {
        try {
          const rows = await getJSON<{ ok: boolean; providers: LlmProviderRow[] }>(
            '/user/llm-providers'
          )
          providerList = rows.providers || []
          if (active) setProviderRows(providerList)
        } catch {
          // 取得失敗時は標準チェーンで進む（下の row 判定で undefined 扱い）。
        }
      }
      const chosenRow = savedTranslation?.providerId
        ? providerList.find(
            row =>
              row.id === savedTranslation.providerId &&
              row.enabled !== false &&
              row.providerType !== 'anthropic'
          )
        : undefined

      // モデル一覧: BYO 行選択時はその行の保存済みモデル、 otherwise（標準設定
      // 跟随）は翻訳サービスの標準チェーン（プロジェクト endpoint > 標準 > .env）。
      const pickModel = (loadedModels: Model[]) => {
        setSelectedModel(current => {
          if (current && loadedModels.some(model => model.id === current)) {
            return current
          }
          if (savedModel && loadedModels.some(model => model.id === savedModel)) {
            return savedModel
          }
          return loadedModels[0]?.id || savedModel || current
        })
      }
      if (chosenRow) {
        if (!active) return
        const loadedModels = chosenRow.models.map(id => ({ id }))
        setModels(loadedModels)
        pickModel(loadedModels)
        return
      }
      try {
        const modelResponse = await getJSON<{ data: Model[] }>('/local-llm/models')
        if (!active) return
        const loadedModels = modelResponse.data || []
        setModels(loadedModels)
        pickModel(loadedModels)
      } catch (modelError) {
        if (active) setError(getErrorMessage(modelError))
      }
    }
    void loadPanel()
    return () => {
      active = false
    }
    // hasSelection は開いた時点の初期対象の決め手だけ（再実行は不要）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  // アンマウント（タブ切り替え・閉じる）で未完了ストリームを必ず止めます。
  useEffect(
    () => () => {
      translationAbortRef.current?.abort()
    },
    []
  )

  /** 翻訳専用欄が選んでいる BYO 行（表示とモデル一覧用。未選択/失効なら undefined）。 */
  const translationRow = translationSettings?.providerId
    ? providerRows.find(
        row =>
          row.id === translationSettings.providerId &&
          row.enabled !== false &&
          row.providerType !== 'anthropic'
      )
    : undefined

  /** 用語集・モデル・文体メモ・プロンプト指示をプロジェクト設定として保存します。 */
  const saveSettings = async (promptOverride?: string) => {
    setSaving(true)
    setError('')
    try {
      const updated = await putJSON<ProjectSettings>(`${projectPath}/settings`, {
        body: {
          terms: terms.filter(term => term.source.trim() && term.target.trim()),
          model: selectedModel || null,
          context,
          prompt_instructions: promptOverride ?? promptInstructions,
        },
      })
      setTerms(updated.terms || [])
      setPromptInstructions(updated.prompt_instructions || '')
      setNotice('用語集・文書コンテキスト・システムプロンプトを保存しました。')
      return true
    } catch (saveError) {
      setError(getErrorMessage(saveError))
      return false
    } finally {
      setSaving(false)
    }
  }

  /** システムプロンプトを既定文へワンクリックで戻します（保存も同時に行います）。 */
  const resetPromptToDefault = async () => {
    if (!window.confirm('システムプロンプトを既定文に戻します。現在の自作指示は削除されます。よろしいですか？')) {
      return
    }
    setPromptInstructions('')
    const saved = await saveSettings('')
    if (saved) {
      setNotice('システムプロンプトを既定文に戻して保存しました。')
    }
  }

  /** 翻訳開始時点の原文・選択位置・対象ドキュメント ID を記録します。 */
  const captureSnapshot = (): Snapshot | null => {
    const sourceDocId = editorManager.getCurrentDocumentId() || ''
    if (!sourceDocId) return null
    if (target === 'selection') {
      // 選択範囲の翻訳は CodeMirror の選択位置が必要（ブリッジが生きている場合のみ）。
      if (!view) return null
      const current = view.state
      const selected = current.selection.main
      if (selected.empty) return null
      const currentDocument = current.doc.toString()
      return {
        text: current.doc.sliceString(selected.from, selected.to),
        document: currentDocument,
        sourceDocId,
        from: selected.from,
        to: selected.to,
        target,
      }
    }
    // 「現在のファイル」翻訳は EditorManager（docstore 由来）の本文を使います。
    const currentDocument = editorManager.getCurrentDocValue()
    if (currentDocument === null) return null
    return {
      text: currentDocument,
      document: currentDocument,
      sourceDocId,
      from: 0,
      to: currentDocument.length,
      target: 'file',
    }
  }

  /** 翻訳開始の入口。スナップショット採取 → 設定保存 → SSE 翻訳の順に進めます。 */
  const runTranslation = async () => {
    const captured = captureSnapshot()
    if (!captured) {
      setError('編集中のエディターが見つかりません。先に .tex ファイルを開いてください。')
      return
    }
    if (!captured.text.trim()) {
      setError('翻訳する内容がありません。')
      return
    }
    if (!captured.sourceDocId) {
      setError('翻訳元の .tex ファイルを特定できません。')
      return
    }
    if (!selectedModel) {
      setError('利用可能なモデルを取得し、使用モデルを選択してください。')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    setResult(null)
    setSnapshot(captured)
    setProgress('用語集と文書メモを保存しています。')
    setCompletedPreview('')
    setPartialPreview('')
    const abortController = new AbortController()
    translationAbortRef.current = abortController
    try {
      const saved = await saveSettings()
      if (abortController.signal.aborted) {
        setNotice('翻訳を停止しました。途中の結果は適用されていません。')
        return
      }
      if (!saved) return
      setProgress('ローカルLLMに接続しています。')
      const reply = await streamTranslation(
        `${projectPath}/translate`,
        { text: captured.text, model: selectedModel },
        abortController.signal,
        event => {
          if (event.type === 'progress') {
            setProgress(event.message)
            if (event.phase === 'retrying') setPartialPreview('')
          }
          if (event.type === 'delta') {
            setPartialPreview(current => current + event.text)
          }
          if (event.type === 'chunk_complete') {
            setCompletedPreview(current => current + event.text)
            setPartialPreview('')
          }
        }
      )
      if (abortController.signal.aborted) return
      setResult(reply)
      setProgress('LaTeX構造の検証が完了しました。')
      if (reply.failed_chunks && reply.failed_chunks.length > 0) {
        setNotice(
          `${reply.chunks} チャンク中 ${reply.failed_chunks.length} 件が翻訳に失敗したため原文を保持しています（第 ${reply.failed_chunks.join('・')} チャンク）。未翻訳部分を直してから、必要なら再実行してください。`
        )
      } else {
        setNotice(`${reply.chunks} チャンクを翻訳しました。内容を確認して英語版として保存してください。`)
      }
    } catch (translationError) {
      // 停止・失敗でも、これまでに確定済みのプレビューは消しません（再実行の材料に残す）。
      if (abortController.signal.aborted) {
        setNotice('翻訳を停止しました。これまでに確定したチャンクはプレビューに残っています。')
      } else {
        setError(getErrorMessage(translationError))
      }
    } finally {
      if (translationAbortRef.current === abortController) {
        translationAbortRef.current = null
      }
      setBusy(false)
      setProgress('')
    }
  }

  /** 翻訳停止。fetch を中断し、Overleaf 経由で LLM まで停止要求を伝えます。 */
  const stopTranslation = () => {
    if (!translationAbortRef.current) return
    setNotice('LLMへの停止要求を送信しています。')
    translationAbortRef.current.abort()
  }

  /** 選択範囲翻訳の結果を原文の該当範囲へ置き換えます（確認ダイアログ付き）。 */
  const applyResult = () => {
    if (!result || !snapshot || !view) return
    if (!canApply) {
      setError('翻訳中に原文が変更されたか、別のファイルへ移動しました。現在の文書で翻訳し直してください。')
      return
    }
    if (
      snapshot.target === 'selection' &&
      !window.confirm(
        '選択範囲を翻訳結果で置き換えます。日本語原文のこの範囲は変更されます。続けますか？'
      )
    ) {
      return
    }
    view.dispatch({
      changes: { from: snapshot.from, to: snapshot.to, insert: result.text },
      selection: { anchor: snapshot.from + result.text.length },
    })
    setNotice('翻訳をエディタへ適用しました。')
    setResult(null)
    setSnapshot(null)
  }

  /**
   * 翻訳結果を同じフォルダーの英語版 .en.tex として保存します。
   * setAsMainDocument が true の場合、保存後にメイン文書設定とタブ切替も行います。
   * 日本語原文は変更しません。保存に成功したら、横並び表示パネルも開きます。
   * 完走していなくても、確定済みチャンク（completedPreview）を草稿として保存できます
   * （その場合は全体検証未実施の旨を確認ダイアログで伝えます）。
   */
  const saveEnglishDocument = async (setAsMainDocument: boolean) => {
    const content = result?.text ?? completedPreview
    if (!content || !snapshot || snapshot.target !== 'file') return
    if (
      !result &&
      !window.confirm(
        '翻訳は完走していません。これまでに確定したチャンクのみを草稿として保存します。' +
          '文書全体の LaTeX 検証は通っていないため、保存後に内容を確認してください。よろしいですか？'
      )
    ) {
      return
    }
    if (!canApply) {
      setError('翻訳中に原文が変更されたか、別のファイルへ移動しました。現在の文書で翻訳し直してください。')
      return
    }

    const sourcePath = pathInFolder(snapshot.sourceDocId)
    const sourceName = sourcePath?.split('/').pop()
    if (!sourceName || !sourceName.toLowerCase().endsWith('.tex')) {
      setError('翻訳元の .tex ファイル名を特定できません。')
      return
    }
    if (sourceName.toLowerCase().endsWith('.en.tex')) {
      setError('英語版ファイルから別の英語版は作成できません。日本語原文のファイルを開いてください。')
      return
    }

    const parentPath = dirname(snapshot.sourceDocId) || ''
    const parent = findEntityByPath(parentPath)
    if (!parent || parent.type !== 'folder') {
      setError('翻訳元ファイルの保存先フォルダーを特定できません。')
      return
    }

    const englishName = `${sourceName.slice(0, -4)}.en.tex`
    const englishPath = [parentPath, englishName].filter(Boolean).join('/')
    const existing = findEntityByPath(englishPath)
    if (existing && existing.type !== 'doc') {
      setError(`${englishPath} という同名のファイルまたはフォルダーがあります。名前を変更してください。`)
      return
    }

    const overwrite = existing?.type === 'doc'
    if (
      overwrite &&
      !window.confirm(
        `${englishPath} は既にあります。翻訳結果で英語版の内容を上書きしますか？日本語原文は変更されません。`
      )
    ) {
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await putJSON<{ doc: { _id: string; name: string } }>(
        `${projectPath}/english-document`,
        {
          body: {
            source_doc_id: snapshot.sourceDocId,
            parent_folder_id: parent.entity._id,
            name: englishName,
            content,
            overwrite,
          },
        }
      )
      setResult(null)
      setSnapshot(null)
      setCompletedPreview('')
      setPartialPreview('')
      // 保存した英語版を横並びパネルへ表示します（日本語と見比べながら編集できます）。
      dispatchOpenSplitPanel(saved.doc._id)
      if (setAsMainDocument) {
        try {
          await postJSON(`/project/${projectId}/settings`, {
            body: { rootDocId: saved.doc._id },
          })
          if (project) updateProject({ rootDocId: saved.doc._id })
          await editorManager.openDoc(saved.doc)
          setNotice(
            `${englishPath} を保存してメイン文書に設定し、英語版タブを開きました。右の横並びパネルにも同じファイルを表示しています。初回は「コンパイル」を押してください。日本語原文は変更していません。`
          )
        } catch (settingsError) {
          setError(
            `英語版は ${englishPath} に保存されましたが、メイン文書またはエディタタブの切り替えに失敗しました。ファイルを右クリックして「メイン文書に設定」を選んでください。${getErrorMessage(settingsError)}`
          )
        }
      } else {
        setNotice(
          `${englishPath} に英語版を${overwrite ? '上書き保存' : '作成'}しました。右の横並びパネルに表示したので、日本語原文と見比べながら確認できます。`
        )
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  /** 確定済みの訳済みチャンクだけをクリップボードへコピーします（退避・再実行用）。 */
  const copyPartialPreview = async () => {
    try {
      await navigator.clipboard.writeText(completedPreview)
      setNotice('訳済みチャンクをクリップボードへコピーしました。プレビューは残っています。')
    } catch {
      setError('コピーに失敗しました。プレビューを自分で選択してコピーしてください。')
    }
  }

  const updateTerm = (index: number, field: keyof GlossaryTerm, value: string) => {
    setTerms(current =>
      current.map((term, termIndex) =>
        termIndex === index ? { ...term, [field]: value } : term
      )
    )
  }

  // パネルの初期表示・翻訳操作の可否を判定します。
  if (!isTex || currentDocumentId === null) {
    const reason =
      currentDocumentId === null
        ? '.tex ファイルを開くと翻訳できます。左のファイルツリーから日本語原文を開いてください。'
        : `現在開いているファイル（${docPath || '不明'}）は .tex ではありません。日本語原文の .tex を開いてください。`
    return (
      <div style={panelRootStyle}>
        <h2 style={titleStyle}>英語翻訳</h2>
        <p style={hintStyle}>{reason}</p>
      </div>
    )
  }

  return (
    <div style={panelRootStyle}>
      <h2 style={titleStyle}>英語翻訳</h2>
      <div style={{ color: 'var(--content-secondary-themed)', fontSize: 12, marginTop: -4, marginBottom: 10 }}>
        LLM: {selectedModel || '未選択'}
      </div>

      {/* 接続先は LLM 設定画面の翻訳専用欄で選びます（パネル側に接続 UI なし）。
          ここでは今どの接続先が効いているかの一行表示と設定画面へのリンクだけ置きます。 */}
      <p style={{ color: 'var(--content-secondary-themed)', fontSize: 12, margin: '0 0 10px' }}>
        接続先:{' '}
        {translationRow ? (
          <>
            {translationRow.name}
            <span style={{ marginLeft: 4 }}>(LLM 設定の BYO 行)</span>
          </>
        ) : (
          '翻訳サービスの標準設定に従う'
        )}
        {' '}
        <a href="/user/llm-settings" target="_blank" rel="noreferrer">
          LLM 設定で変更
        </a>
      </p>
      <label style={fieldStyle}>
        使用モデル
        <select
          className="form-control"
          value={selectedModel}
          onChange={event => setSelectedModel(event.target.value)}
          disabled={!models.length || busy}
        >
          {selectedModel && !models.some(model => model.id === selectedModel) && (
            <option value={selectedModel}>{selectedModel} (現在の設定)</option>
          )}
          {models.map(model => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
      </label>

      <details style={{ marginBottom: 12 }}>
        <summary style={summaryStyle}>翻訳対象</summary>
        <label style={{ display: 'block', marginTop: 6 }}>
          <input
            type="radio"
            name="local-llm-target"
            checked={target === 'selection'}
            disabled={!hasSelection || busy}
            onChange={() => setTarget('selection')}
          />{' '}
          選択範囲
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="radio"
            name="local-llm-target"
            checked={target === 'file'}
            disabled={busy}
            onChange={() => setTarget('file')}
          />{' '}
          現在の .tex ファイル
        </label>
      </details>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0 10px' }}>
        <input
          type="checkbox"
          checked={consented}
          disabled={busy}
          onChange={event => setConsented(event.target.checked)}
        />
        <span style={{ fontSize: 13 }}>
          選択した内容を設定済みのローカルLLMへ送信することを確認しました。翻訳結果はプレビューで確認してから保存します。
        </span>
      </label>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {busy ? (
          <button type="button" className="btn btn-danger" onClick={stopTranslation}>
            翻訳を停止
          </button>
        ) : result ? (
          snapshot?.target === 'file' ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canApply || saving}
                title={canApply ? undefined : '翻訳中に文書が変更されました。翻訳し直してください。'}
                onClick={() => saveEnglishDocument(false)}
              >
                英語版 .tex 保存
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canApply || saving}
                title={canApply ? undefined : '翻訳中に文書が変更されました。翻訳し直してください。'}
                onClick={() => saveEnglishDocument(true)}
              >
                {saving ? '保存中…' : '保存し英語版をメイン文書に'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canApply || saving}
              title={canApply ? undefined : '翻訳中に文書が変更されました。翻訳し直してください。'}
              onClick={applyResult}
            >
              選択範囲を原文に適用
            </button>
          )
        ) : completedPreview ? (
          <>
            {snapshot?.target === 'file' && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canApply || saving}
                title={canApply ? undefined : '翻訳中に文書が変更されました。翻訳し直してください。'}
                onClick={() => saveEnglishDocument(false)}
              >
                {saving ? '保存中…' : '訳済み部分だけ .en.tex に保存'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={copyPartialPreview}>
              訳済み部分をコピー
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!consented || saving || !selectedModel}
            onClick={runTranslation}
          >
            確認して翻訳
          </button>
        )}
      </div>

      {snapshot && (
        <div style={previewBlockStyle}>
          <strong>日本語原文</strong>
          <pre style={previewStyle}>{snapshot.text}</pre>
          <strong style={{ marginTop: 8 }}>英訳プレビュー</strong>
          <pre style={previewStyle}>
            {result?.text || (
              <>
                {completedPreview}
                {/* 生成途中の訳片。保護マーカーは「…」に伏せて仮表示します。 */}
                {busy && partialPreview && (
                  <span style={partialPreviewStyle}>
                    {maskPartialMarkers(partialPreview)}
                  </span>
                )}
                {busy && !partialPreview && !completedPreview && (
                  <span style={partialPreviewStyle}>
                    {progress || '翻訳を準備しています。'}
                  </span>
                )}
                {!busy && !completedPreview && '翻訳結果はここに表示されます。'}
              </>
            )}
          </pre>
          {busy && (
            <div role="status" aria-live="polite" style={progressStyle}>
              {progress}
            </div>
          )}
        </div>
      )}

      {error && <div role="alert" className="alert alert-danger">{error}</div>}
      {notice && <div role="status" className="alert alert-info">{notice}</div>}

      <details style={{ marginTop: 8 }}>
        <summary style={summaryStyle}>用語集・文書コンテキスト・システムプロンプト</summary>
        <p style={{ color: 'var(--content-secondary-themed)', margin: '8px 0' }}>
          用語集と概要はプロジェクト単位で保存し、翻訳の各チャンクに渡します。
        </p>
        {terms.map((term, index) => (
          <div
            key={index}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, marginBottom: 6 }}
          >
            <input
              className="form-control"
              aria-label="日本語の用語"
              placeholder="日本語"
              value={term.source}
              onChange={event => updateTerm(index, 'source', event.target.value)}
            />
            <input
              className="form-control"
              aria-label="指定する英語訳"
              placeholder="English"
              value={term.target}
              onChange={event => updateTerm(index, 'target', event.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="用語を削除"
              onClick={() => setTerms(current => current.filter((_, i) => i !== index))}
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setTerms(current => [...current, { source: '', target: '' }])}
        >
          用語を追加
        </button>
        <label style={{ ...fieldStyle, marginTop: 12 }}>
          論文の概要・文体メモ
          <textarea
            className="form-control"
            rows={3}
            maxLength={4000}
            value={context}
            onChange={event => setContext(event.target.value)}
            placeholder="例: 分散システムを対象とする実証研究。簡潔なacademic writingを使う。"
          />
        </label>
        <label style={{ ...fieldStyle, marginTop: 4 }}>
          システムプロンプト（スタイル・役割の指示）
          <textarea
            className="form-control"
            rows={4}
            maxLength={4000}
            value={promptInstructions}
            onChange={event => setPromptInstructions(event.target.value)}
            placeholder={'空欄なら既定のシステムプロンプトを使います。例:\n' + defaultPrompt}
          />
        </label>
        <p style={{ color: 'var(--content-secondary-themed)', margin: '4px 0 8px', fontSize: 12 }}>
          空欄 = 既定文。翻訳のトーン・役割の指示だけ差し替わります。保護マーカー維持などの
          検証前提の指示は常に自動で添えられます。
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving || busy}
            onClick={() => saveSettings()}
          >
            {saving ? '保存中…' : '用語集・プロンプトを保存'}
          </button>
          {promptInstructions !== '' && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving || busy}
              onClick={resetPromptToDefault}
            >
              プロンプトを既定文に戻す
            </button>
          )}
        </div>
      </details>
    </div>
  )
}

// ---- パネルの装飾用スタイル（レール幅に合わせた縦積みの固定値） ------------

const panelRootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: 12,
  gap: 2,
  height: '100%',
  overflowY: 'auto',
  // レールの他パネルと同じテーマ変数に追従させます（ダークテーマでは
  // 濃い背景＋明るい文字、ライトテーマではその逆 automatically に切り替わります）。
  background: 'var(--bg-primary-themed)',
  color: 'var(--content-primary-themed)',
}

const titleStyle: CSSProperties = { margin: '0 0 6px', fontSize: 17 }

const hintStyle: CSSProperties = { color: 'var(--content-secondary-themed)', margin: '-4px 0 8px', fontSize: 12 }

const fieldStyle: CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 10,
  fontSize: 13,
}

const summaryStyle: CSSProperties = { cursor: 'pointer', fontWeight: 600 }

const previewBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: '6px 0 10px',
}

const previewStyle: CSSProperties = {
  minHeight: 90,
  maxHeight: 260,
  overflow: 'auto',
  padding: 10,
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  background: 'var(--bg-secondary-themed)',
  border: '1px solid var(--border-primary-themed)',
  borderRadius: 4,
  fontSize: 12,
}

const partialPreviewStyle: CSSProperties = {
  color: 'var(--content-secondary-themed)',
  opacity: 0.75,
  fontStyle: 'italic',
}

const progressStyle: CSSProperties = {
  minHeight: 18,
  marginTop: 4,
  color: 'var(--content-secondary-themed)',
  fontSize: 12,
}

// 描画クラッシュ時も日本語のエラー表示が残るよう、エラー境界で包んで公開します。
export default withErrorBoundary(TranslationPanel, PanelErrorFallback)
