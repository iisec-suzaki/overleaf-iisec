// コンパイルログのパスをプロジェクト内の文書へ対応付けます。
// 同名ファイルが複数ある場合は一つを推測せず、呼び出し側に未解決を返します。
export function findSourceFile(docs, file) {
  const normalize = path =>
    String(path || '')
      .replace(/^\/?compile\//, '')
      .replace(/^\.\//, '')
      .replace(/^\//, '')
  const target = normalize(file)
  if (!target) return null
  const entries = Object.entries(docs || {}).filter(([, value]) =>
    Array.isArray(value?.lines)
  )
  const exact = entries.filter(([path]) => normalize(path) === target)
  const candidates = exact.length
    ? exact
    : entries.filter(([path]) => {
        const normalized = normalize(path)
        return (
          normalized.endsWith('/' + target) || target.endsWith('/' + normalized)
        )
      })
  if (candidates.length !== 1) return null
  return { path: candidates[0][0], lines: candidates[0][1].lines }
}
