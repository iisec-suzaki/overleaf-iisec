import { useRef, useEffect } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import LLMCompliancePane from './llm-compliance-pane'
import { useLLMFeatures } from '../hooks/use-llm-features'
import { watchEditorTheme } from '../utils/llm-editor-theme'
import '../../stylesheets/llm-ui.scss'

// overleaf-lab (2026-11-26): 「Compliance Review」専用レールタブ。
// 従来は「AI Assistant」レール内部のタブ（チャット／文書レビュー）に
// 格納していたが、発見しにくいため独立のレールタブへ移植した。
// レール自体は chat（AI Assistant）の直後に表示され、タブストリップは持たない。
function LLMComplianceRailPane() {
  const rootRef = useRef<HTMLDivElement>(null)
  const features = useLLMFeatures()
  useEffect(() => {
    // レールはエディターとは別の DOM にあるため、配色だけを監視して追従させる。
    const watcher = watchEditorTheme([rootRef.current])
    return () => watcher.stop()
  }, [])
  return (
    <div className="llm-rail-panel llm-wf-editor-scoped" ref={rootRef}>
      <RailPanelHeader title="Compliance Review" />
      {features.loaded && !features.reviewEnabled ? (
        <p style={{ padding: '0 12px' }}>
          管理者によって文書レビュー機能が無効になっています。
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
          <LLMCompliancePane />
        </div>
      )}
    </div>
  )
}

const entry: RailElement = {
  key: 'llm-compliance',
  icon: 'check_circle',
  title: 'Compliance Review',
  component: <LLMComplianceRailPane />,
  hide: () => !getMeta('ol-ExposedSettings').llmEnabled,
}
export default entry
