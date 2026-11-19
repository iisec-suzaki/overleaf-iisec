// BYO 追加ドラフトの描画リグレッション（fork 側 React #137 再現テストの移植）。
// 「Add provider」を開いてドラフト編集器が mount できること、接続テストの
// 結果が Flash メッセージへ出ること（OLNotification の props 事故で
// 空アイコンになっていた回帰）を、jsdom + testing-library で検証する。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import UserSettings from '../frontend/js/components/llm-settings-section'

const api = vi.hoisted(() => ({ getJSON: vi.fn(), postJSON: vi.fn() }))
vi.mock('@/infrastructure/fetch-json', () => api)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}))
vi.mock('@/shared/components/material-icon', () => ({ default: () => null }))
vi.mock('@/utils/meta', () => ({
  default: (key: string) =>
    ({
      'ol-ExposedSettings': { llmEnabled: true, llmAllowUserSettings: true },
    })[key],
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.getJSON.mockImplementation(async (path: string) =>
    path.includes('feature-models')
      ? { ok: true, models: {}, chatContextMode: 'auto', chatContextBudget: 0 }
      : path.includes('providers')
        ? { ok: true, providers: [], maxProviders: 10 }
        : { ok: false }
  )
  api.postJSON.mockImplementation(async (path: string) => {
    if (path.includes('/check')) {
      return {
        ok: true,
        message: 'Connection successful',
        models: ['qwen-test'],
        providerType: 'openaiCompatible',
        detectedProviderType: 'openaiCompatible',
        duration: '12ms',
      }
    }
    return { ok: true, provider: {} }
  })
})

async function openDraft() {
  render(<UserSettings />)
  const add = await screen.findByRole('button', { name: 'Add provider' })
  fireEvent.click(add)
  await waitFor(() =>
    expect(document.querySelector('.llm-buo-editor')).toBeTruthy()
  )
}

it('opens the add-provider draft editor without throwing', async () => {
  await openDraft()
  expect(document.querySelector('#llm-buo-name')).toBeTruthy()
  expect(document.querySelector('#llm-buo-url')).toBeTruthy()
})

it('shows the connection test result as a notification', async () => {
  await openDraft()
  fireEvent.change(document.querySelector('#llm-buo-url')!, {
    target: { value: 'https://llm.example.com/v1' },
  })
  const modelInput = document.querySelector(
    '.llm-buo-model-editor input'
  ) as HTMLInputElement
  fireEvent.change(modelInput, { target: { value: 'qwen-test' } })
  fireEvent.keyDown(modelInput, { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  expect(await screen.findByText(/Connection successful/)).toBeTruthy()
  await waitFor(() =>
    expect(
      api.postJSON.mock.calls.some(([path]) =>
        path.endsWith('/user/llm-providers/check')
      )
    ).toBe(true)
  )
})
