import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// 実コントローラーへ別ワーカーの保存状態を渡し、外部接続なしで照会と停止を確認します。
const fixture = { doc: null, patch: null }
globalThis.__llmWorkerTest = fixture
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/LLMComplianceController.mjs')) {
      let code
      if (specifier === '@overleaf/logger')
        code = 'export default {info(){},warn(){},debug(){},error(){}}'
      if (specifier === '@overleaf/settings') code = 'export default {}'
      if (specifier === '@overleaf/promise-utils')
        code = 'export const expressify=fn=>fn'
      if (specifier.includes('SessionManager'))
        code = 'export default {getLoggedInUserId:()=>"user"}'
      if (specifier.includes('ProjectEntityHandler')) code = 'export default {}'
      if (specifier.includes('LLMAdminController'))
        code =
          'export const getAdminLLMSettings=async()=>({}),getLLMFeatureFlags=async()=>({reviewEnabled:true}),getLLMPrompts=async()=>({})'
      if (specifier.includes('LLMSettingsController'))
        code = 'export const getComplianceRubricsForUser=async()=>[]'
      if (specifier.includes('LLMChatController'))
        code = 'export const resolveModelLane=async()=>({})'
      if (specifier.includes('LLMClient'))
        code =
          'export const chatText=async()=>({}),chatObject=async()=>({}),listModels=async()=>({}),normalizeProviderSpec=()=>({})'
      if (specifier.includes('LLMReviewJob'))
        code = `export const persistJobCreate=async()=>{},persistJobUpdate=async()=>{},heartbeatReviewJob=async()=>{},persistStuckJobs=async()=>{},countUserActiveJobs=async()=>0;
      export const findUserJobDoc=async()=>globalThis.__llmWorkerTest.doc;
      export const persistJobFinalStatus=async(id,patch)=>{globalThis.__llmWorkerTest.patch=patch}`
      if (code)
        return {
          url: 'data:text/javascript,' + encodeURIComponent(code),
          shortCircuit: true,
        }
    }
    return next(specifier, context)
  },
})
const { default: controller } =
  await import('../src/LLMComplianceController.mjs')
hooks.deregister()
const request = { params: { jobId: 'job', Project_id: 'project' }, session: {} }
async function call(handler) {
  let result
  await handler(request, {
    json: value => {
      result = value
      return value
    },
  })
  return result
}
test('polling another live worker preserves the running review and its progress', async () => {
  fixture.doc = {
    jobId: 'job',
    projectId: 'project',
    status: 'running',
    passesDone: 2,
    passesTotal: 8,
  }
  const result = await call(controller.statusReview)
  assert.equal(result.status, 'running')
  assert.equal(result.passesDone, 2)
  assert.equal(fixture.patch, null)
})
test('completed reviews remain retrievable through another worker', async () => {
  fixture.doc = {
    jobId: 'job',
    projectId: 'project',
    status: 'done',
    result: { summary: 'done' },
  }
  assert.deepEqual((await call(controller.statusReview)).result, {
    summary: 'done',
  })
})
test('a remote cancellation persists a signal for the executing worker', async () => {
  fixture.doc = { jobId: 'job', projectId: 'project', status: 'running' }
  await call(controller.cancelReview)
  assert.equal(fixture.patch.cancelRequested, true)
  assert.equal(fixture.patch.status, undefined)
})
test('a job from another project is not returned through this project route', async () => {
  fixture.doc = {
    jobId: 'job',
    projectId: 'other',
    status: 'done',
    result: { summary: 'private' },
  }
  assert.equal((await call(controller.statusReview)).error, 'not_found')
})
