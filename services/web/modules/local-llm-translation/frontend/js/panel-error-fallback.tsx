// パネル共通の簡易エラー境界表示（fork 由来）。
// Overleaf 公式の既定フォールバックは空要素なので、原因が分かる日本語を渡す。
import type { FallbackProps } from "react-error-boundary";

export default function PanelErrorFallback({ error }: FallbackProps) {
  return (
    <div
      style={{
        padding: 12,
        background: "var(--bg-primary-themed)",
        color: "var(--content-primary-themed)",
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: 17 }}>
        パネルの表示に失敗しました
      </h2>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          fontSize: 12,
          background: "var(--bg-secondary-themed)",
          padding: 8,
          border: "1px solid var(--border-primary-themed)",
          borderRadius: 4,
        }}
      >
        {String((error as Error)?.message || error)}
      </pre>
      <p style={{ fontSize: 12, color: "var(--content-secondary-themed)" }}>
        ブラウザーのコンソール（F12）に詳細ログがあります。この画面を再読み込みすると
        復帰する場合があります。
      </p>
    </div>
  );
}
