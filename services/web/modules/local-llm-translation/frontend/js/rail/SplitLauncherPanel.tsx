/**
 * 左レール（セクション）の「横並び表示」タブです。
 *
 * 横並び編集パネル（BilingualEditorPanel）の起動口。ファイル一覧から .tex を
 * 選ぶとエディターの右に第 3 列として開き、「閉じる」で取り払います。
 * 翻訳保存時の自動表示と同じ overleaf:open/close-bilingual-editor イベントで
 * 通信します。
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useEditorManagerContext } from "@/features/ide-react/context/editor-manager-context";
import { useFileTreeData } from "@/shared/context/file-tree-data-context";
import withErrorBoundary from "@/infrastructure/error-boundary";
import PanelErrorFallback from "../panel-error-fallback";
import { collectTexDocs } from "../split/tex-docs";

/** 横並びパネルへ「このファイルを開いて / 全部閉じて」と伝えます。 */
function dispatchSplit(
  event: "overleaf:open-bilingual-editor" | "overleaf:close-bilingual-editor",
  docId?: string,
) {
  window.dispatchEvent(
    new CustomEvent(event, docId ? { detail: { docId } } : undefined),
  );
}

function SplitLauncherPanel() {
  const editorManager = useEditorManagerContext();
  const { fileTreeData } = useFileTreeData();

  const texDocs = useMemo(
    () => collectTexDocs(fileTreeData as unknown),
    [fileTreeData],
  );

  // 開閉イベントの結果を反映します（翻訳保存時の自動表示も含む）。
  const [openDocIds, setOpenDocIds] = useState<string[]>([]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string }>).detail;
      if (detail?.docId)
        setOpenDocIds((previous) =>
          previous.includes(detail.docId as string)
            ? previous
            : [...previous, detail.docId as string],
        );
    };
    const onCloseAll = () => setOpenDocIds([]);
    window.addEventListener("overleaf:open-bilingual-editor", onOpen);
    window.addEventListener("overleaf:close-bilingual-editor", onCloseAll);
    return () => {
      window.removeEventListener("overleaf:open-bilingual-editor", onOpen);
      window.removeEventListener("overleaf:close-bilingual-editor", onCloseAll);
    };
  }, []);

  const currentDocId = editorManager.getCurrentDocumentId();

  return (
    <div style={panelRootStyle}>
      <h2 style={titleStyle}>横並び表示</h2>
      <p style={hintStyle}>
        選んだ .tex
        をエディターの右にもう１列表示し、日本語原文と英語版を見比べながら編集できます
        （メインエディターで同じファイルを開くと読み取り専用になります）。
      </p>

      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}
      >
        <button
          type="button"
          className="btn btn-primary"
          disabled={!currentDocId}
          title={
            currentDocId ? undefined : "先に .tex ファイルを開いてください"
          }
          onClick={() => {
            if (currentDocId)
              dispatchSplit("overleaf:open-bilingual-editor", currentDocId);
          }}
        >
          開いているファイルを横並びに
        </button>
        {openDocIds.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => dispatchSplit("overleaf:close-bilingual-editor")}
          >
            閉じる
          </button>
        )}
      </div>

      {openDocIds.length > 0 && (
        <div role="status" style={noticeStyle}>
          横並び中表示:{" "}
          {openDocIds
            .map(
              (id) => texDocs.find((doc) => doc.id === id)?.path || "（不明）",
            )
            .join(", ")}
        </div>
      )}

      {texDocs.length === 0 ? (
        <p style={hintStyle}>プロジェクトに .tex ファイルがありません。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {texDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="btn btn-secondary"
              style={{
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              onClick={() =>
                dispatchSplit("overleaf:open-bilingual-editor", doc.id)
              }
            >
              {openDocIds.includes(doc.id) ? "● " : ""}
              {doc.path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- パネルの装飾用スタイル（レール幅に合わせた縦積みの固定値） --------------

const panelRootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: 12,
  gap: 2,
  height: "100%",
  overflowY: "auto",
  // レールの他パネルと同じテーマ変数に追従させます。
  background: "var(--bg-primary-themed)",
  color: "var(--content-primary-themed)",
};

const titleStyle: CSSProperties = { margin: "0 0 6px", fontSize: 17 };

const hintStyle: CSSProperties = {
  color: "var(--content-secondary-themed)",
  margin: "0 0 8px",
  fontSize: 12,
};

const noticeStyle: CSSProperties = {
  margin: "0 0 8px",
  padding: "6px 8px",
  background: "var(--bg-tertiary-themed)",
  border: "1px solid var(--content-warning-themed)",
  borderRadius: 4,
  fontSize: 12,
};

// 描画クラッシュ時も日本語のエラー表示が残るよう、エラー境界で包んで公開します。
export default withErrorBoundary(SplitLauncherPanel, PanelErrorFallback);
