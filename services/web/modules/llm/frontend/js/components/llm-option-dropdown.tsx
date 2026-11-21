import { MouseEventHandler, forwardRef } from 'react'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import DropdownMenuItem from '@/shared/components/dropdown/dropdown-menu-item'
import MaterialIcon from '@/shared/components/material-icon'

// Editing/Reviewing 切替（review-mode-switcher）と同じ見た目・構造のドロップダウン。
// トグル＝ピル型ボタン（アイコン＋現在値＋▼）、メニューは DropdownMenuItem の
// タイトル＋説明＋アクティブ表示（グローバルの dropdown-menu.scss をそのまま流用）。
// モデル選択と推論レベル選択の両方で共有する。

export interface LLMOptionItem {
  value: string
  label: string
  /** トグル（閉じている時）にだけ見せたい補強ラベル（省略時は label） */
  toggleLabel?: string
  description?: string
  leadingIcon?: string
  active?: boolean
}

const LLMOptionDropdownButton = forwardRef<
  HTMLButtonElement,
  {
    id?: string
    onClick: MouseEventHandler<HTMLButtonElement>
    'aria-expanded': boolean
    ariaLabel: string
    icon: string
    label: string
    title?: string
    disabled?: boolean
  }
>(
  (
    {
      id,
      onClick,
      'aria-expanded': ariaExpanded,
      ariaLabel,
      icon,
      label,
      title,
      disabled,
    },
    ref
  ) => (
    <button
      ref={ref}
      type="button"
      className="llm-option-dropdown-toggle"
      data-testid={id}
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title || label}
    >
      <MaterialIcon type={icon} />
      <div className="llm-option-dropdown-label">{label}</div>
      <MaterialIcon type="keyboard_arrow_down" />
    </button>
  )
)
LLMOptionDropdownButton.displayName = 'LLMOptionDropdownButton'

export default function LLMOptionDropdown({
  id,
  ariaLabel,
  icon,
  items,
  onSelect,
  disabled,
  title,
}: {
  id: string
  ariaLabel: string
  icon: string
  items: LLMOptionItem[]
  onSelect: (value: string) => void
  disabled?: boolean
  title?: string
}) {
  const current = items.find(item => item.active)
  const currentLabel = current
    ? current.toggleLabel ?? current.label
    : (items[0]?.label ?? '')
  return (
    <OLDropdown className="llm-option-dropdown" align="start">
      <OLDropdownToggle
        as={LLMOptionDropdownButton}
        id={id}
        ariaLabel={ariaLabel}
        icon={icon}
        label={currentLabel}
        title={title}
        disabled={disabled}
      />
      <OLDropdownMenu flip>
        {items.map(item => (
          <DropdownMenuItem
            key={item.value}
            description={item.description}
            leadingIcon={item.leadingIcon}
            active={item.active}
            disabled={disabled}
            onClick={() => onSelect(item.value)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </OLDropdownMenu>
    </OLDropdown>
  )
}
