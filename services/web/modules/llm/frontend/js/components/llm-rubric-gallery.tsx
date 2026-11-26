// overleaf-lab (rubric sharing prototype, 2026-11-26, owner request): a
// deployment-wide SHARED rubric gallery, modeled on the LaTeX template gallery
// (searchable card grid). Every lab member can publish a snapshot of one of
// their compliance review items, and anyone can copy it into their own personal
// rubric list. Copied items flow through the normal personal save path, so
// sharing is a one-time copy — never a live link that changes under someone.
//
// Reached from /user/llm-settings (Compliance Review section) and directly at
// /user/llm/compliance/gallery. Backend: LLMSettingsController shared endpoints.
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import MaterialIcon from '@/shared/components/material-icon'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import '../../stylesheets/llm-settings.scss'

interface SharedRubric {
    shareId: string
    name: string
    guidelines: string
    scanPatterns?: string
    ownerId: string
    ownerName: string
    importCount: number
    createdAt?: string | null
    updatedAt?: string | null
    isMine?: boolean
}

interface OwnRubric {
    id: string
    name: string
    guidelines: string
    scanPatterns?: string
}

export default function LLMRubricGallery() {
    const { t } = useTranslation()
    const { isReady } = useWaitForI18n()
    const reviewEnabled = getMeta('ol-reviewEnabled') !== false

    const [items, setItems] = useState<SharedRubric[]>([])
    const [loaded, setLoaded] = useState(false)
    const [query, setQuery] = useState('')
    const [busyId, setBusyId] = useState<string | null>(null)
    const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

    // publish panel
    const [showPublish, setShowPublish] = useState(false)
    const [ownRubrics, setOwnRubrics] = useState<OwnRubric[]>([])
    const [pubForm, setPubForm] = useState({ name: '', guidelines: '', scanPatterns: '' })
    const [publishing, setPublishing] = useState(false)

    const flash = (type: 'success' | 'error', msg: string) => {
        setToast({ type, msg })
        setTimeout(() => setToast(null), 4000)
    }

    const loadList = useCallback((q: string) => {
        const url = q ? `/user/llm/compliance/shared?q=${encodeURIComponent(q)}` : '/user/llm/compliance/shared'
        getJSON<{ ok?: boolean; rubrics?: SharedRubric[] }>(url)
            .then(data => {
                setItems(Array.isArray(data?.rubrics) ? data.rubrics : [])
                setLoaded(true)
            })
            .catch(() => setLoaded(true))
    }, [])

    useEffect(() => {
        if (isReady) loadList(query)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady])

    // Debounce the search box so typing does not hammer the API.
    useEffect(() => {
        if (!isReady) return
        const id = setTimeout(() => loadList(query), 300)
        return () => clearTimeout(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query])

    const openPublish = () => {
        // Prefill the panel from the user's own rubrics so publishing an item
        // they already wrote is a single click.
        getJSON<{ ok?: boolean; rubrics?: OwnRubric[] }>('/user/llm/compliance')
            .then(data => setOwnRubrics(Array.isArray(data?.rubrics) ? data.rubrics : []))
            .catch(() => setOwnRubrics([]))
        setShowPublish(true)
    }

    const publish = async () => {
        setPublishing(true)
        try {
            const data = await postJSON<{ ok?: boolean; message?: string }>(
                '/user/llm/compliance/shared',
                { body: pubForm },
            )
            if (data?.ok) {
                flash('success', t('share_published', 'Published to the shared gallery.'))
                setShowPublish(false)
                setPubForm({ name: '', guidelines: '', scanPatterns: '' })
                loadList(query)
            } else {
                flash('error', data?.message || t('share_failed', 'Publishing failed.'))
            }
        } catch (err: any) {
            flash('error', err?.data?.message || err?.message || t('share_failed', 'Publishing failed.'))
        } finally {
            setPublishing(false)
        }
    }

    const doImport = async (share: SharedRubric) => {
        setBusyId(share.shareId)
        try {
            const { rubric: copy } = await postJSON<{ rubric: OwnRubric }>(
                '/user/llm/compliance/shared/import',
                { body: { shareId: share.shareId } },
            )
            // Append to the user's own list and save through the normal path.
            const mine = await getJSON<{ rubrics?: OwnRubric[] }>('/user/llm/compliance')
            const list = [...(Array.isArray(mine?.rubrics) ? mine.rubrics : []), copy]
            await postJSON('/user/llm/compliance', { body: { rubrics: list } })
            flash(
                'success',
                t('share_imported', 'Added to your rubrics. You can edit it under Compliance Review in LLM Settings.'),
            )
            loadList(query)
        } catch (err: any) {
            flash('error', err?.data?.message || err?.message || t('share_failed', 'Import failed.'))
        } finally {
            setBusyId(null)
        }
    }

    const doUnpublish = async (share: SharedRubric) => {
        setBusyId(share.shareId)
        try {
            await postJSON(`/user/llm/compliance/shared/${encodeURIComponent(share.shareId)}/unpublish`, {
                body: {},
            })
            flash('success', t('share_unpublished', 'Removed from the shared gallery.'))
            loadList(query)
        } catch (err: any) {
            flash('error', err?.data?.message || err?.message || t('share_failed', 'Removal failed.'))
        } finally {
            setBusyId(null)
        }
    }

    if (!reviewEnabled) {
        return (
            <OLPageContentCard>
                <p className="ol-llm-admin-settings__muted-md">
                    {t('compliance_disabled', 'The compliance review feature is disabled on this deployment.')}
                </p>
            </OLPageContentCard>
        )
    }

    return (
        <div className="llm-rubric-gallery">
            <OLPageContentCard>
                <div className="page-header ol-rubric-gallery__header">
                    <div>
                        <h1>{t('rubric_gallery_title', 'Shared Review Items')}</h1>
                        <p className="ol-rubric-gallery__subtitle ol-llm-admin-settings__muted-md">
                            {t(
                                'rubric_gallery_help',
                                'Review items lab members choose to share. Browse and copy one into your own settings, or publish your own so colleagues can reuse it.',
                            )}
                        </p>
                    </div>
                    <OLButton variant="primary" size="sm" type="button" onClick={openPublish}>
                        <MaterialIcon type="share" className="me-1 ol-llm-admin-settings__icon-base" />
                        {t('share_publish_cta', 'Share a review item')}
                    </OLButton>
                </div>

                <div className="ol-rubric-gallery__toolbar">
                    <OLFormControl
                        type="search"
                        value={query}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                        placeholder={t('rubric_gallery_search', 'Search shared items…')}
                    />
                </div>

                {toast && (
                    <div className="ol-rubric-gallery__toast">
                        <OLNotification type={toast.type} content={toast.msg} />
                    </div>
                )}

                {showPublish && (
                    <div className="ol-rubric-gallery__publish">
                        <h2 className="ol-rubric-gallery__publish-title">
                            {t('share_publish_title', 'Publish a review item')}
                        </h2>
                        {ownRubrics.length > 0 && (
                            <OLFormGroup controlId="llm-share-prefill">
                                <OLFormLabel>
                                    {t('share_from_own', 'Start from one of your rubrics')}
                                </OLFormLabel>
                                <OLFormControl
                                    as="select"
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                        const r = ownRubrics.find(x => x.id === e.target.value)
                                        if (r)
                                            setPubForm({
                                                name: r.name,
                                                guidelines: r.guidelines || '',
                                                scanPatterns: r.scanPatterns || '',
                                            })
                                    }}
                                >
                                    <option value="">{t('share_pick_none', '— blank form —')}</option>
                                    {ownRubrics.map(r => (
                                        <option key={r.id} value={r.id}>
                                            {r.name}
                                        </option>
                                    ))}
                                </OLFormControl>
                            </OLFormGroup>
                        )}
                        <OLFormGroup controlId="llm-share-name">
                            <OLFormLabel>{t('rubric_name', 'Rubric name')}</OLFormLabel>
                            <OLFormControl
                                type="text"
                                value={pubForm.name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setPubForm(p => ({ ...p, name: e.target.value }))
                                }
                            />
                        </OLFormGroup>
                        <OLFormGroup controlId="llm-share-guidelines">
                            <OLFormLabel>{t('rubric_guidelines', 'Guidelines')}</OLFormLabel>
                            <OLFormControl
                                as="textarea"
                                rows={6}
                                value={pubForm.guidelines}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                    setPubForm(p => ({ ...p, guidelines: e.target.value }))
                                }
                                className="ol-llm-admin-settings__mono"
                            />
                        </OLFormGroup>
                        <OLFormGroup controlId="llm-share-scans">
                            <OLFormLabel>
                                {t('rubric_scan_patterns', 'Scan patterns (optional, one per line)')}
                            </OLFormLabel>
                            <OLFormControl
                                as="textarea"
                                rows={3}
                                value={pubForm.scanPatterns}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                    setPubForm(p => ({ ...p, scanPatterns: e.target.value }))
                                }
                                className="ol-llm-admin-settings__mono"
                            />
                            <OLFormText>
                                {t(
                                    'share_publish_note',
                                    'Publishing stores a snapshot. Editing your personal rubric later will not change what others already imported.',
                                )}
                            </OLFormText>
                        </OLFormGroup>
                        <div className="ol-llm-admin-settings__row-end">
                            <OLButton variant="tertiary" size="sm" type="button" onClick={() => setShowPublish(false)}>
                                {t('cancel', 'Cancel')}
                            </OLButton>
                            <OLButton
                                variant="primary"
                                size="sm"
                                type="button"
                                onClick={publish}
                                isLoading={publishing}
                                disabled={publishing || !pubForm.name.trim()}
                            >
                                {t('share_publish_now', 'Publish')}
                            </OLButton>
                        </div>
                    </div>
                )}

                {!loaded ? (
                    <p className="ol-llm-admin-settings__muted-md">{t('loading', 'Loading…')}</p>
                ) : items.length === 0 ? (
                    <p className="ol-rubric-gallery__empty ol-llm-admin-settings__muted-md">
                        {query
                            ? t('share_no_results', 'No shared items match your search.')
                            : t('share_none_yet', 'No review items have been shared yet. Be the first to share one!')}
                    </p>
                ) : (
                    <div className="row ol-rubric-gallery__grid">
                        {items.map(item => (
                            <div key={item.shareId} className="ol-rubric-gallery__card col-12 col-md-6 col-lg-4">
                                <div className="ol-rubric-gallery__card-body">
                                    <div className="ol-rubric-gallery__card-head">
                                        <h3 className="ol-rubric-gallery__card-title" title={item.name}>
                                            {item.name}
                                        </h3>
                                        {item.isMine && (
                                            <span className="ol-rubric-gallery__badge ol-rubric-gallery__badge--mine">
                                                {t('share_mine', 'Yours')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="ol-rubric-gallery__author">
                                        <MaterialIcon type="person" className="ol-rubric-gallery__author-icon" />
                                        {item.ownerName || t('share_anonymous', 'Lab member')}
                                    </p>
                                    <p className="ol-rubric-gallery__snippet">
                                        {(item.guidelines || '').slice(0, 180)}
                                        {(item.guidelines || '').length > 180 ? '…' : ''}
                                    </p>
                                    <div className="ol-rubric-gallery__meta">
                                        <MaterialIcon type="download" className="ol-rubric-gallery__meta-icon" />
                                        {t('share_imports_count', '{{count}} imports', {
                                            count: item.importCount || 0,
                                        })}
                                    </div>
                                </div>
                                <div className="ol-rubric-gallery__card-actions">
                                    <OLButton
                                        variant="secondary"
                                        size="sm"
                                        type="button"
                                        onClick={() => doImport(item)}
                                        disabled={busyId === item.shareId}
                                        isLoading={busyId === item.shareId}
                                    >
                                        <MaterialIcon type="library_add" className="me-1 ol-llm-admin-settings__icon-base" />
                                        {t('share_add_to_my', 'Add to my settings')}
                                    </OLButton>
                                    {item.isMine && (
                                        <OLButton
                                            variant="link"
                                            size="sm"
                                            type="button"
                                            onClick={() => doUnpublish(item)}
                                            disabled={busyId === item.shareId}
                                        >
                                            {t('share_unpublish', 'Unshare')}
                                        </OLButton>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </OLPageContentCard>
        </div>
    )
}
