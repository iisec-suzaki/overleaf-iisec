/**
 * 左レール（セクション）の「横並び表示」タブ定義です。
 * railEntries（settings.defaults.js）から登録され、日本語/英語 .tex の
 * 横並びパネル（SplitFilePanel）を開く・閉じる入口を提供します。
 */
import type { RailElement } from '@/features/ide-react/util/rail-types'
import SplitLauncherPanel from './SplitLauncherPanel'

const splitRailEntry = {
  key: 'split-view',
  // call_split は Material Symbols の分割アイコン（unfilled 一覧に存在）。
  icon: 'call_split',
  title: '横並び表示',
  component: <SplitLauncherPanel />,
} as unknown as RailElement

export default splitRailEntry
