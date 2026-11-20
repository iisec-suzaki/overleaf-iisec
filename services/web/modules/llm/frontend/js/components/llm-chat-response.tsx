import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { buildChatDiffRows } from '../utils/llm-chat-diff'
import { applyChatEdit, ChatEdit, ChatEditLocation, parseChatEdits, locateChatEditInEditor, previewChatEdit, clearChatEditPreview } from '../utils/llm-chat-edits'

function EditCard({ edit, autoPreview }: { edit: ChatEdit; autoPreview: boolean }) {
    const id = useId()
    const autoPreviewAttempted = useRef(false)
    const [status, setStatus] = useState<'pending' | 'applied' | 'dismissed' | 'conflict'>('pending')
    const [location, setLocation] = useState<ChatEditLocation>()
    const [previewing, setPreviewing] = useState(false)
    const [previewError, setPreviewError] = useState(false)
    const review = useCallback((action: string) => {
        autoPreviewAttempted.current = true
        if (action === 'apply') {
            const ok = applyChatEdit(edit)
            setStatus(ok ? 'applied' : 'conflict')
            clearChatEditPreview(id)
        } else {
            if (action === 'dismiss') setStatus('dismissed')
            clearChatEditPreview(id)
        }
        setPreviewing(false)
    }, [edit, id])
    useEffect(() => {
        let disposed = false
        const refresh = () => {
            setLocation(locateChatEditInEditor(edit))
            if (!autoPreview || autoPreviewAttempted.current) return
            // Document notifications can arrive inside a CodeMirror update. Wait
            // until it finishes before dispatching another editor transaction.
            queueMicrotask(() => {
                if (disposed || autoPreviewAttempted.current || !locateChatEditInEditor(edit)) return
                const ok = previewChatEdit(edit, id)
                if (ok) autoPreviewAttempted.current = true
                setPreviewing(ok)
            })
        }
        const previewStatus = (event: Event) => setPreviewing((event as CustomEvent).detail?.id === id)
        const action = (event: Event) => {
            const detail = (event as CustomEvent).detail
            if (detail?.id === id) review(detail.action)
        }
        window.addEventListener('llm-chat-document-changed', refresh)
        window.addEventListener('llm-chat-preview-status', previewStatus)
        window.addEventListener('llm-chat-review-action', action)
        refresh()
        return () => {
            disposed = true
            window.removeEventListener('llm-chat-document-changed', refresh)
            window.removeEventListener('llm-chat-preview-status', previewStatus)
            window.removeEventListener('llm-chat-review-action', action)
            clearChatEditPreview(id)
        }
    }, [edit, id, review, autoPreview])
    const rows = buildChatDiffRows(edit.oldText, edit.newText, location?.startLine)
    const pending = status === 'pending' || status === 'conflict'
    return (
        <section className="llm-chat-edit" aria-label={`変更案: ${edit.file}`}>
            <strong>{edit.file}</strong>
            <div className="llm-diff-location">
                {location ? `元ファイル ${location.startLine}–${location.endLine}行` : '抜粋内の相対行番号（対象ファイルを開くと実際の行番号を表示）'}
            </div>
            <details open={status !== 'dismissed'}>
                <summary>変更内容を確認 <span className="llm-diff-legend">− 削除（赤） / ＋ 追加（緑）</span></summary>
                <div className="llm-diff-column-labels" aria-hidden="true"><span>変更前</span><span>変更後</span></div>
                <pre className="llm-chat-diff" aria-label="変更前後の差分と行番号">{rows.map((row, index) => (
                    <span key={index} className={`llm-diff-line llm-diff-${row.kind}`}>
                        <span className="llm-diff-number" aria-label="変更前の行番号">{row.oldLine ?? ''}</span>
                        <span className="llm-diff-number" aria-label="変更後の行番号">{row.newLine ?? ''}</span>
                        <span className="llm-diff-sign">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</span>
                        <span className="llm-diff-code">{row.text || ' '}</span>
                    </span>
                ))}</pre>
            </details>
            {pending && <div className="llm-edit-actions">
                <button type="button" aria-pressed={previewing} onClick={() => {
                    autoPreviewAttempted.current = true
                    if (previewing) { review('close'); return }
                    const ok = previewChatEdit(edit, id)
                    setPreviewing(ok)
                    setPreviewError(!ok)
                    setLocation(locateChatEditInEditor(edit))
                }}>{previewing ? 'プレビューを閉じる' : 'エディターで確認'}</button>
                <button type="button" onClick={() => review('apply')}>適用</button>
                <button type="button" onClick={() => review('dismiss')}>却下</button>
            </div>}
            <div role="status">
                {status === 'applied' && '適用しました。エディターの「元に戻す」で取り消せます。'}
                {status === 'dismissed' && '却下しました。'}
                {status === 'conflict' && '適用できません。対象ファイルをソースエディターで開いてください。元の文章が変更済み・複数箇所に存在する場合や、閲覧権限のみの場合は適用できません。'}
                {pending && previewError && 'プレビューできません。対象ファイルをソースエディターで開き、元の文章が変更されていないか確認してください。'}
            </div>
        </section>
    )
}

export default function LLMChatResponse({ content, assistant, autoPreview = false }: { content: string; assistant: boolean; autoPreview?: boolean }) {
    const { markdown, edits } = useMemo(() => assistant ? parseChatEdits(content) : { markdown: content, edits: [] }, [assistant, content])
    return <>
        <div className="message-content"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(markdown) as string,
                { USE_PROFILES: { html: true, svg: false, mathMl: false } }) }} />
        {edits.map((edit, index) => <EditCard key={index} edit={edit} autoPreview={autoPreview && index === 0} />)}
    </>
}
