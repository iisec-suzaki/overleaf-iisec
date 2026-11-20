/**
 * 左レール（セクション）の「英語翻訳」タブ定義です。
 * railEntries（settings.defaults.js）から登録され、ファイルツリーや
 * プロジェクト検索と同じ並びにタブとして表示されます。
 */
import type { RailElement } from '@/features/ide-react/util/rail-types'
import TranslationPanel from './TranslationPanel'

const translationRailEntry = {
  key: 'translation',
  icon: 'translate',
  title: '英語翻訳',
  component: <TranslationPanel />,
} as unknown as RailElement

export default translationRailEntry
