import { diffLines } from 'diff'

export interface ChatDiffRow {
    kind: 'added' | 'removed' | 'unchanged'
    text: string
    oldLine?: number
    newLine?: number
}

// Numbers refer to the source file when startLine is known; otherwise they are
// explicitly relative to the excerpt. Added numbers describe the proposed file.
export function buildChatDiffRows(oldText: string, newText: string, startLine = 1): ChatDiffRow[] {
    let oldLine = startLine
    let newLine = startLine
    const rows: ChatDiffRow[] = []
    for (const part of diffLines(oldText, newText)) {
        const lines = part.value.split('\n')
        if (lines[lines.length - 1] === '') lines.pop()
        for (const text of lines) {
            rows.push({
                kind: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
                text,
                oldLine: part.added ? undefined : oldLine++,
                newLine: part.removed ? undefined : newLine++,
            })
        }
    }
    return rows
}
