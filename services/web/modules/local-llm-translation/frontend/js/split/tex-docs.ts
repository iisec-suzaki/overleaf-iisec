/**
 * ファイルツリー（公式の FileTreeData）から .tex 文書を收集する共有ヘルパーです。
 * 横並び表示パネル（SplitFilePanel）と横並び起動タブ（SplitLauncherPanel）の
 * 両方で使います。
 */

export type TexDocOption = { id: string; name: string; path: string }

/** root Folder ノードを再帰的に辿り、.tex 文書だけを id/表示パス付きで列挙します。 */
export function collectTexDocs(folder: unknown): TexDocOption[] {
  const docs: TexDocOption[] = []
  const visit = (node: {
    name: string
    docs?: { _id: string; name: string }[]
    subFolders?: unknown[]
  }) => {
    for (const doc of node.docs || []) {
      if (doc.name.toLowerCase().endsWith('.tex')) {
        docs.push({ id: doc._id, name: doc.name, path: `${node.name}/${doc.name}` })
      }
    }
    for (const child of node.subFolders || []) {
      visit(child as Parameters<typeof visit>[0])
    }
  }
  if (folder) visit(folder as Parameters<typeof visit>[0])
  return docs
}
