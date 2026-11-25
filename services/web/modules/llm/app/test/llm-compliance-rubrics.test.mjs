// overleaf-lab (2026-08-27): the shared rubric helpers used by BOTH the admin
// save and the new per-user compliance rubric save. They are pure functions,
// so this is a plain node:test file (no app context needed).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
    sanitizeComplianceRubrics,
    validateComplianceRubrics,
} from '../src/LLMAdminController.mjs'
import {
    LLMReviewJob,
    persistJobCreate,
    persistJobUpdate,
    persistJobFinalStatus,
    persistStuckJobs,
    findUserJobDoc,
    countUserActiveJobs,
} from '../src/models/LLMReviewJob.mjs' // overleaf-lab (audit M2)
// overleaf-lab: paragraph-aware chunking for documents too big for one review pass.
import { splitIntoChunks } from '../src/llm-chunk.mjs'

test('sanitizeComplianceRubrics: non-array -> null (caller keeps existing)', () => {
    assert.equal(sanitizeComplianceRubrics(undefined), null)
    assert.equal(sanitizeComplianceRubrics(null), null)
    assert.equal(sanitizeComplianceRubrics('nope'), null)
})

test('sanitizeComplianceRubrics: drops incomplete entries, caps lengths and count', () => {
    const longName = 'x'.repeat(500)
    const longGuidelines = 'g'.repeat(50000)
    const list = [
        ...Array.from({ length: 12 }, (_, i) => ({
            id: `r${i}`,
            name: `rubric ${i}`,
            guidelines: '1. be kind',
            scanPatterns: 'Wikipedia :: wikipedia',
        })),
        { id: '', name: 'no id', guidelines: 'x' },
        { id: 'nom', name: '', guidelines: 'x' },
        { id: 'cap', name: longName, guidelines: longGuidelines, scanPatterns: 'p'.repeat(9000) },
    ]
    const out = sanitizeComplianceRubrics(list)
    assert.equal(out.length, 13) // 15 in - 2 incomplete; well under the cap of 50
    const cap = out.find(r => r.id === 'cap')
    assert.equal(cap.name.length, 200)
    assert.equal(cap.guidelines.length, 20000)
    assert.equal(cap.scanPatterns.length, 4000)
})

test('sanitizeComplianceRubrics: caps the list at 50 rubrics', () => {
    const big = Array.from({ length: 55 }, (_, i) => ({ id: `r${i}`, name: `rubric ${i}` }))
    assert.equal(sanitizeComplianceRubrics(big).length, 50)
})

test('validateComplianceRubrics: clean list -> null', () => {
    const ok = [
        { name: 'a', scanPatterns: '' },
        { name: 'b', scanPatterns: 'Wikipedia :: wikipedia\nFirst person :: (?<![\\w.@/])io\\b' },
    ]
    assert.equal(validateComplianceRubrics(ok), null)
    assert.equal(validateComplianceRubrics(null), null)
})

test('validateComplianceRubrics: invalid regex and over-long patterns are rejected', () => {
    const badRegex = [{ name: 'r', scanPatterns: 'Broken :: (unclosed' }]
    assert.match(
        validateComplianceRubrics(badRegex),
        /Invalid scan pattern regex in rubric "r"/,
    )
    const tooLong = [{ name: 'r', scanPatterns: 'a'.repeat(4001) }]
    assert.match(
        validateComplianceRubrics(tooLong),
        /must be 4000 characters or fewer/,
    )
})




test('audit M2: review job schema — identity, status enum, indexes', () => {
    const s = LLMReviewJob.schema
    assert.equal(s.path('jobId').options.unique, true)
    assert.equal(s.path('status').options.enum.join(','), 'queued,running,done,error,cancelled')
    assert.notEqual(s.path('userId').index, undefined)
    // overleaf-lab: mongoose reports `type: Object` as instance 'Mixed'
    assert.ok(['Mixed', 'Object'].includes(s.path('result').instance))
})

test('audit M2: persist helpers are non-fatal without a Mongo connection', async () => {
    const job = {
        id: 'job-x',
        projectId: 'p1',
        userId: 'u1',
        status: 'queued',
        result: null,
        errorCode: null,
        message: null,
        rubricId: 'r',
        rubricName: 'R',
        modelOverride: null,
        documentTokensEstimate: null,
        maxContextTokens: null,
        reviewMaxTokens: null,
        passesTotal: null,
        passesDone: 0,
        currentRequirement: '',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
    }
    // every helper must RESOLVE (error logged and swallowed), never throw
    await persistJobCreate(job)
    await persistJobUpdate('job-x', job)
    assert.equal(await findUserJobDoc('job-x', 'u1'), null)
    assert.equal(await countUserActiveJobs('u1'), null)
    await persistJobFinalStatus('job-x', { status: 'cancelled' })
    await persistStuckJobs('restarted')
})

// overleaf-lab: splitIntoChunks (port of the translation service's split_chunks).
// The chunking must be lossless (chunks concatenate back to the original), never
// exceed the budget, and prefer paragraph boundaries so a review chunk is a whole
// run of paragraphs rather than a slice through a sentence.
test('splitIntoChunks: text within budget -> one chunk, unchanged (and guards)', () => {
    const text = 'hello\n\nworld'
    assert.deepEqual(splitIntoChunks(text, 100), [text])
    assert.deepEqual(splitIntoChunks('', 100), [''])
    assert.throws(() => splitIntoChunks('x', 0))
})

test('splitIntoChunks: many paragraphs -> bounded, paragraph-aligned, lossless', () => {
    const para = `${'A'.repeat(200)}\n\n` // one paragraph, exactly 202 chars
    const text = para.repeat(10) // 2020 chars, four paragraphs fit in 700
    const maxChars = 700
    const chunks = splitIntoChunks(text, maxChars)
    assert.ok(chunks.length > 1, 'long text must split')
    for (const c of chunks) assert.ok(c.length <= maxChars, `chunk too big: ${c.length}`)
    assert.equal(chunks.join(''), text) // lossless concatenation, no overlap or gap
    // Paragraph-aligned: every chunk is a whole number of paragraphs.
    for (const c of chunks) assert.equal(c.length % para.length, 0)
})

test('splitIntoChunks: single giant line with spaces -> bounded by word, lossless', () => {
    const text = 'word '.repeat(1000) // 5000 chars, spaces but no newlines
    const maxChars = 400
    const chunks = splitIntoChunks(text, maxChars)
    assert.ok(chunks.length > 1)
    for (const c of chunks) assert.ok(c.length <= maxChars, `chunk too big: ${c.length}`)
    assert.equal(chunks.join(''), text)
})

test('splitIntoChunks: unbreakable token run -> hard cut exactly at the limit', () => {
    const text = 'Z'.repeat(950) // no space or newline anywhere
    const maxChars = 400
    const chunks = splitIntoChunks(text, maxChars)
    assert.deepEqual(
        chunks.map(c => c.length),
        [400, 400, 150]
    )
    assert.equal(chunks.join(''), text)
})
