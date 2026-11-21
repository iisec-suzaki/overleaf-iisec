import { CSSProperties, useRef, useEffect, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import LLMChatPane from './llm-chat-pane'
import LLMCompliancePane from './llm-compliance-pane'
import { useLLMFeatures } from '../hooks/use-llm-features'
import { watchEditorTheme } from '../utils/llm-editor-theme'
import '../../stylesheets/llm-ui.scss'

function LLMRailPane() {
  const rootRef = useRef<HTMLDivElement>(null)
  const features = useLLMFeatures()
  const [tab, setTab] = useState<'chat' | 'review'>('chat')
  useEffect(() => {
    if (features.loaded && !features.chatEnabled && features.reviewEnabled)
      setTab('review')
    if (features.loaded && !features.reviewEnabled && features.chatEnabled)
      setTab('chat')
  }, [features.loaded, features.chatEnabled, features.reviewEnabled])
  useEffect(() => {
    // レールはエディターとは別のDOMにあるため、配色だけを監視して追従させます。
    const watcher = watchEditorTheme([rootRef.current])
    return () => watcher.stop()
  }, [])
  // 伊藤さん試作（port/complete-sync c9e89d9482）の下線型タブを復刻。
  // クラス装飾が無く素の button に見えていた問題の修正で、アクセント下線は
  // ペーン配色の --wf-accent（ライト #28518f / ダーク #6597e0）に追従する。
  const tabButtonStyle = (active: boolean): CSSProperties => ({
    appearance: 'none',
    background: 'none',
    border: 'none',
    padding: '6px 12px',
    cursor: 'pointer',
    // inherit にして「AI Assistant」見出しと同じ色に保つ（ダークテーマでも読める）
    color: 'inherit',
    opacity: active ? 1 : 0.6,
    fontWeight: active ? 600 : 400,
    borderBottom: active
      ? '2px solid var(--wf-accent, var(--bg-accent-01, #3265b5))'
      : '2px solid transparent',
  })
  return (
    <div className="llm-rail-panel llm-wf-editor-scoped" ref={rootRef}>
      <RailPanelHeader title="AI Assistant" />
      <div
        role="tablist"
        aria-label="AI機能"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom:
            '1px solid var(--border-divider, rgba(125,125,125,0.2))',
        }}
      >
        {features.chatEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            style={tabButtonStyle(tab === 'chat')}
            onClick={() => setTab('chat')}
          >
            チャット
          </button>
        )}
        {features.reviewEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'review'}
            style={tabButtonStyle(tab === 'review')}
            onClick={() => setTab('review')}
          >
            文書レビュー
          </button>
        )}
      </div>
      {features.loaded && !features.chatEnabled && !features.reviewEnabled && (
        <p>管理者によってAI機能が無効になっています。</p>
      )}
      {/* 非表示側もマウントを保ち、タブ切替で会話やレビューの進行状況を失わないようにします。 */}
      {features.chatEnabled && (
        <div
          style={{
            display: tab === 'chat' ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* モデル／推論レベルの選択はチャット画面上部（LLMChatPane）にまとめた。 */}
          <LLMChatPane />
        </div>
      )}
      {features.reviewEnabled && (
        <div
          style={{
            display: tab === 'review' ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <LLMCompliancePane />
        </div>
      )}
    </div>
  )
}

const entry: RailElement = {
  key: 'llm-chat',
  icon: 'smart_toy',
  title: 'AI Assistant',
  component: <LLMRailPane />,
  hide: () => !getMeta('ol-ExposedSettings').llmEnabled,
}
export default entry
