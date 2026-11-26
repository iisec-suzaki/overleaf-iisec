import React from 'react'
import { useTranslation } from 'react-i18next'
import LLMComplianceSettings from './llm-compliance-settings'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { UserProvider } from '@/shared/context/user-context'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useScrollToIdOnLoad from '@/shared/hooks/use-scroll-to-id-on-load'
// overleaf-lab: shared module + upstream-AI design tokens used by the settings chrome.
import '../../stylesheets/llm-settings.scss'
import '../../stylesheets/llm-ui.scss'

// overleaf-lab (2026-11-26, owner request): the Compliance Review (check item +
// checklist) configuration now lives on its OWN page (/user/compliance-review),
// split out of the BYO /user/llm-settings page so it is reachable straight from
// the editor's Settings (gear) menu without dragging in the provider settings.
export default function LLMCompliancePage() {
    const { t } = useTranslation()
    const { isReady } = useWaitForI18n()
    useScrollToIdOnLoad()

    return (
        <div className="container">
            <OLRow>
                <OLCol xl={{ span: 10, offset: 1 }}>
                    {isReady ? (
                        <UserProvider>
                            <OLPageContentCard>
                                <div className="page-header">
                                    <h1>{t('compliance_review', 'Compliance Review')}</h1>
                                </div>
                                <div id="compliance">
                                    <LLMComplianceSettings />
                                </div>
                            </OLPageContentCard>
                        </UserProvider>
                    ) : null}
                </OLCol>
            </OLRow>
        </div>
    )
}
