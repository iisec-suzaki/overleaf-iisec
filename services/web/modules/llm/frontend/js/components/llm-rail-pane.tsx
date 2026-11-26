import { useRef, useEffect } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import LLMChatPane from './llm-chat-pane'
import { useLLMFeatures } from '../hooks/use-llm-features'
import { watchEditorTheme } from '../utils/llm-editor-theme'
import '../../stylesheets/llm-ui.scss'

// overleaf-lab: AI Assistant レール。従来は内部に「チャット／文書レビュー」の
// タブを持っていたが、文書レビューは 2026-11-26 に独立の「Compliance Review」
// レールタブへ移植した（llm-compliance-rail-pane.tsx）。ここではチャットのみを
// 描画し、タブストリップは撤去した。
function LLMRailPane() {
  const rootRef = useRef<HTMLDivElement>(null)
  const features = useLLMFeatures()
  useEffect(() => {
    // レールはエディターとは別のDOMにあるため、配色だけを監視して追従させます。
    const watcher = watchEditorTheme([rootRef.current])
    return () => watcher.stop()
  }, [])
  return (
    <div className="llm-rail-panel llm-wf-editor-scoped" ref={rootRef}>
      <RailPanelHeader title="AI Assistant" />
      {features.loaded && !features.chatEnabled ? (
        <p style={{ padding: '0 12px' }}>
          管理者によってチャット機能が無効になっています。
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* モデル／推論レベルの選択はチャット画面上部（LLMChatPane）にまとめた。 */}
          <LLMChatPane />
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
