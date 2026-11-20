import { useCodeMirrorViewContext } from "@/features/source-editor/components/codemirror-context";
import { useEditorOpenDocContext } from "@/features/ide-react/context/editor-open-doc-context";
import MaterialIcon from "@/shared/components/material-icon";

/** メインで開いている.texを右へ移す。最後のメインタブは公式の制約どおり残す。 */
export default function BilingualEditorButton() {
  const view = useCodeMirrorViewContext();
  const { currentDocumentId, currentDocument, openDocName } =
    useEditorOpenDocContext();
  const available =
    currentDocumentId &&
    currentDocument?.cm6?.view === view &&
    /\.tex$/i.test(openDocName || "");
  return (
    <button
      type="button"
      className="ol-cm-toolbar-button"
      disabled={!available}
      aria-label="現在のファイルを右の横並びパネルへ移す"
      title="現在のファイルを右の横並びパネルへ移す"
      onClick={() => {
        if (available)
          window.dispatchEvent(
            new CustomEvent("overleaf:open-bilingual-editor", {
              detail: { docId: currentDocumentId, move: true },
            }),
          );
      }}
    >
      <MaterialIcon type="arrow_forward_ios" />
    </button>
  );
}
