import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSourceFile } from '../src/LLMSourceFile.mjs'
const docs = {
  '/a/main.tex': { lines: ['A'] },
  '/b/main.tex': { lines: ['B'] },
  '/paper.tex': { lines: ['P'] },
}
test('compilation paths resolve to a unique project path', () => {
  assert.equal(findSourceFile(docs, 'compile/a/main.tex').path, '/a/main.tex')
  assert.equal(
    findSourceFile(docs, '/tmp/build/b/main.tex').path,
    '/b/main.tex'
  )
  assert.equal(findSourceFile(docs, 'paper.tex').path, '/paper.tex')
})
test('ambiguous and missing files cannot select a source to modify', () => {
  assert.equal(findSourceFile(docs, 'main.tex'), null)
  assert.equal(findSourceFile(docs, 'missing.tex'), null)
  assert.equal(findSourceFile(docs, ''), null)
})
