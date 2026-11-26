import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import LLMRubricGallery from '../../components/llm-rubric-gallery'

renderInReactLayout('rubric-gallery-root', () => <LLMRubricGallery />)
