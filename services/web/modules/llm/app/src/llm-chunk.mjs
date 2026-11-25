// overleaf-lab: pure document-chunking helper, kept in its own module so it is
// unit-testable with a plain node:test file (the compliance controller pulls in
// Express, Mongo and the logger, which a bare test import cannot load). The
// algorithm is a port of the translation service's split_chunks
// (translation-service/app/latex.py): paragraph-aware greedy chunking reused for
// compliance review of a document that does not fit the model context window in a
// single pass. We split ONLY when the text exceeds the budget, and inside each
// window we prefer a break in the LATTER half (blank line = paragraph > newline >
// space) so every chunk stays near full and no tiny fragment is stranded. The
// Python original also hides LaTeX spans (math, verb, environments) behind
// markers so it never cuts one, then restores them after translating; review
// sends read-only excerpts and never writes them back, so that protect/restore
// round-trip is irrelevant here and only the boundary-preference loop is ported.

// Python str.rfind(sub, lo, hi): rightmost index i with lo <= i and i+len(sub) <= hi.
function rfindInRange(str, needle, lo, hi) {
    let found = -1
    let from = Math.max(0, lo)
    for (;;) {
        const j = str.indexOf(needle, from)
        if (j === -1 || j + needle.length > hi) {
            break
        }
        found = j
        from = j + 1
    }
    return found
}

// Split `text` into pieces at most `maxChars` long, breaking on the most natural
// boundary available near the end of each window. Returns the whole text as one
// element when it already fits. Never returns an empty piece.
export function splitIntoChunks(text, maxChars) {
    const s = String(text || '')
    if (maxChars <= 0) {
        throw new Error('Chunk size must be positive')
    }
    if (s.length <= maxChars) {
        return [s]
    }
    const chunks = []
    let start = 0
    while (start < s.length) {
        let hardEnd = Math.min(start + maxChars, s.length)
        if (hardEnd < s.length) {
            // Look for a natural boundary in the second half of the window so the
            // chunk is neither half-empty nor left to overflow the budget.
            const lowerBound = start + Math.max(1, Math.floor(maxChars / 2))
            const splitAt = Math.max(
                rfindInRange(s, '\n\n', start, hardEnd),
                rfindInRange(s, '\n', lowerBound, hardEnd),
                rfindInRange(s, ' ', lowerBound, hardEnd)
            )
            if (splitAt >= lowerBound) {
                hardEnd = splitAt + (s.startsWith('\n\n', splitAt) ? 2 : 1)
            }
        }
        if (hardEnd <= start) {
            // No boundary at all (one giant token run): cut at the hard limit.
            hardEnd = Math.min(start + maxChars, s.length)
        }
        chunks.push(s.slice(start, hardEnd))
        start = hardEnd
    }
    return chunks
}

export default { splitIntoChunks }
