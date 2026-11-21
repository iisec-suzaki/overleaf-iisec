// overleaf-lab: owner request (2026-08-25) — the CHAT AI window (and other
// AI surfaces in the IDE) must follow the EDITOR theme ("The code editor
// color scheme", IDE → Appearance → Editor theme), not a fixed palette.
//
// Mechanism (no timers, event-driven only):
//   1. On demand + on theme/overall-theme changes, read the Live editor's
//      computed background/foreground (CodeMirror root or its scroller).
//   2. Write --wf-editor-bg / --wf-editor-fg on the scoped element
//      (.llm-wf-editor-scoped — rail panel, selection toolbar overlay).
//   3. llm-ui.scss maps the whole token layer onto those two values via
//      color-mix, so bubbles/borders/code surfaces derive from the editor
//      theme automatically.
//
// Fallback: if no editor node exists yet (lazy load) or it is transparent,
// the variables are simply not set and the fixed upstream palette applies.
const isTransparent = (v: string | null): boolean =>
  !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)'

// 背景はエディター系のノードのうち「最初に不透明な色を持つもの」を採用する。
// 既存実装は `bg || scroller.bg` を使っていたが、computed background の
// 透明値 'rgba(0, 0, 0, 0)' は真値なので scroller が一度も参照されず、
// 背景が .cm-content 側に乗るテーマでは bg 只在庫・fg のみ適用となり、
// 「背景は全体テーマ色・文字だけエディター色（白背景に白文字）」になって
// いた（2026-11-21 ユーザー報告）。探索対象に .cm-content/.cm-sizer も追加。
export function readEditorThemeColors(): { bg?: string; fg?: string } {
  const editor = document.querySelector<HTMLElement>('.cm-editor')
  if (!editor) return {}
  const bgNodes = [
    editor,
    editor.querySelector<HTMLElement>('.cm-scroller'),
    editor.querySelector<HTMLElement>('.cm-content'),
    editor.querySelector<HTMLElement>('.cm-sizer'),
  ]
  const out: { bg?: string; fg?: string } = {}
  for (const el of bgNodes) {
    if (!el) continue
    const v = getComputedStyle(el).backgroundColor
    if (!isTransparent(v)) {
      out.bg = v
      break
    }
  }
  // 文字色は本文ノード（.cm-content）が最もテーマを反映する。
  const fgNodes = [editor.querySelector<HTMLElement>('.cm-content'), editor]
  for (const el of fgNodes) {
    if (!el) continue
    const v = getComputedStyle(el).color
    if (v) {
      out.fg = v
      break
    }
  }
  return out
}

// 背景がどのノードにも読めないテーマ向けの安全網: 文字色の明度から
// 背景を推定し、背景と文字色の組合せが必ず対照になるようにする。
function fallbackBgForFg(fg: string): string | undefined {
  const m = fg.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!m) return undefined
  const lum =
    (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
  return lum > 0.5 ? '#1b222c' : '#ffffff'
}

export function applyEditorThemeVars(scope: HTMLElement | null): void {
  if (!scope) return
  const { bg, fg } = readEditorThemeColors()
  const effectiveBg = bg ?? (fg ? fallbackBgForFg(fg) : undefined)
  if (effectiveBg) scope.style.setProperty('--wf-editor-bg', effectiveBg)
  if (fg) scope.style.setProperty('--wf-editor-fg', fg)
  // Keep the accent legible on DARK editor themes (e.g. dracula/monokai
  // chosen while the overall UI stays light): navy on near-black is
  // unreadable, so switch to the light blue accent automatically.
  if (effectiveBg) {
    const m = effectiveBg.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
    if (m) {
      const lum =
        (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) /
        255
      if (lum < 0.5) {
        scope.style.setProperty('--wf-accent', '#6597e0')
        scope.style.setProperty('--wf-accent-hi', '#7dabec')
        scope.style.setProperty('--wf-accent-soft', 'rgba(101, 151, 224, 0.16)')
        return
      }
    }
  }
  scope.style.setProperty('--wf-accent', '#28518f')
  scope.style.setProperty('--wf-accent-hi', '#214475')
  scope.style.setProperty('--wf-accent-soft', 'rgba(40, 81, 143, 0.10)')
}

export interface EditorThemeWatcher {
  stop: () => void
}

// Watches overall theme flips (core writes data-theme on <body>; older
// builds used data-bs-theme on <html>) and the editor element's
// class/attribute/style changes (theme application), then re-reads colors.
export function watchEditorTheme(
  scopes: Array<HTMLElement | null>
): EditorThemeWatcher {
  const update = () => {
    scopes.forEach(applyEditorThemeVars)
  }

  update()

  const docObs = new MutationObserver(() => {
    // Slight delay: theme CSS may apply after the attribute mutation.
    window.setTimeout(update, 0)
  })
  const themeAttrs = ['data-bs-theme', 'data-theme', 'class']
  if (document.documentElement) {
    docObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: themeAttrs,
    })
  }
  if (document.body) {
    docObs.observe(document.body, {
      attributes: true,
      attributeFilter: themeAttrs,
    })
  }

  let editorObs: MutationObserver | undefined
  let mountObs: MutationObserver | undefined
  const attachEditorObserver = () => {
    const editor = document.querySelector<HTMLElement>('.cm-editor')
    if (!editor) return false
    if (editorObs) editorObs.disconnect()
    editorObs = new MutationObserver(update)
    editorObs.observe(editor, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'aria-theme'],
    })
    applyEditorThemeVars(editor) // the editor itself is a good scope
    return true
  }
  if (!attachEditorObserver()) {
    // Editor may mount late (IDE lazy-loads the file pane).
    mountObs = new MutationObserver(() => {
      if (attachEditorObserver() && mountObs) mountObs.disconnect()
    })
    mountObs.observe(document.body, { childList: true, subtree: true })
    // Safety: stop the mount observer if the editor never appears, so it
    // can never outlive the pane.
    window.setTimeout(() => mountObs?.disconnect(), 15000)
  }

  return {
    stop() {
      docObs.disconnect()
      editorObs?.disconnect()
      mountObs?.disconnect()
    },
  }
}
