import { useRef, useEffect, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import LLMChatPane from './llm-chat-pane'
import LLMCompliancePane from './llm-compliance-pane'
import { useLLMFeatures } from '../hooks/use-llm-features'
import { useLLMModelSelection } from '../hooks/use-llm-model-selection'
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
  const models = useLLMModelSelection()
  useEffect(() => {
    // レールはエディターとは別のDOMにあるため、配色だけを監視して追従させます。
    const watcher = watchEditorTheme([rootRef.current])
    return () => watcher.stop()
  }, [])
  return (
    <div className="llm-rail-panel llm-wf-editor-scoped" ref={rootRef}>
      <RailPanelHeader title="AI Assistant" />
      <div role="tablist" aria-label="AI機能">
        {features.chatEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
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
          <label style={{ padding: 8 }}>
            モデル
            <select
              aria-label="チャットのモデル"
              value={models.selected}
              disabled={!models.loaded || models.saving}
              onChange={event => models.apply(event.target.value)}
            >
              <option value="">既定のモデル</option>
              {models.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.rowName ? `${option.rowName} · ` : ''}
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {models.saveError && <p role="alert">{models.saveError}</p>}
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
