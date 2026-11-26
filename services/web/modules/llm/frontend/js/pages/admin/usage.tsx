import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import LLMUsageAdminPage from '../../components/llm-usage-admin-page'

renderInReactLayout('usage-admin-root', () => <LLMUsageAdminPage />)
