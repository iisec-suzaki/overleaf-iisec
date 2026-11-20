import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'

export default function LLMUserSection() {
  const { t } = useTranslation()
  const exposed = getMeta('ol-ExposedSettings')
  // fork 準拠：ユーザー用 LLM 設定の表示は llmAllowUserSettings でも制御される
  // （LLM 自体が無効なときは出さない）。
  if (!exposed.llmEnabled || !exposed.llmAllowUserSettings) return null
  return (
    <section className="mb-4">
      <h2>{t('llm_section_title', 'AI assistant')}</h2>
      <p>
        {t(
          'llm_section_help',
          'Manage your LLM connections, model selection and review settings.'
        )}
      </p>
      <a className="btn btn-secondary" href="/user/llm-settings">
        {t('llm_section_open', 'Open AI settings')}
      </a>
    </section>
  )
}
