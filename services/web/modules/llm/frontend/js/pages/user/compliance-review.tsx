import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import LLMCompliancePage from '../../components/llm-compliance-page'

renderInReactLayout('compliance-page-root', () => <LLMCompliancePage />)
