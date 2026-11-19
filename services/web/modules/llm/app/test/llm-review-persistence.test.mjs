import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LLMReviewJob,
  heartbeatReviewJob,
  persistStuckJobs,
} from '../src/models/LLMReviewJob.mjs'

test('heartbeat cannot revive a terminal job or erase a remote cancellation', async () => {
  const original = LLMReviewJob.findOneAndUpdate
  let query, update
  LLMReviewJob.findOneAndUpdate = (filter, change) => {
    query = filter
    update = change
    return { lean: async () => ({ cancelRequested: true }) }
  }
  try {
    const result = await heartbeatReviewJob({ id: 'job', status: 'running' })
    assert.equal(result.cancelRequested, true)
    assert.deepEqual(query.status.$in, ['queued', 'running'])
    assert.equal(Object.hasOwn(update.$set, 'cancelRequested'), false)
    assert.ok(update.$set.heartbeatAt instanceof Date)
  } finally {
    LLMReviewJob.findOneAndUpdate = original
  }
})
test('restart recovery targets expired heartbeats instead of every running job', async () => {
  const original = LLMReviewJob.updateMany
  let query
  LLMReviewJob.updateMany = async filter => {
    query = filter
    return { modifiedCount: 0 }
  }
  try {
    await persistStuckJobs()
    assert.ok(query.$or[0].heartbeatAt.$lt instanceof Date)
    assert.ok(Date.now() - query.$or[0].heartbeatAt.$lt.getTime() >= 45000)
    assert.equal(query.$or[1].heartbeatAt, null)
  } finally {
    LLMReviewJob.updateMany = original
  }
})
