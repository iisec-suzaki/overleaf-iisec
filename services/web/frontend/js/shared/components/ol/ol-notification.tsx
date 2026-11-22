// llm モジュール移植に伴い追加: ext-ce 系ブランチに存在した薄いラッパー。
// 既存の Notification（shared/components/notification）を通知リスト用 div で
// 囲むだけで、見た目の仕様は Notification 本体と同一です。
import Notification from '@/shared/components/notification'

function OLNotification(props: React.ComponentProps<typeof Notification>) {
  return (
    <div className="notification-list">
      <Notification {...props} />
    </div>
  )
}

export default OLNotification
