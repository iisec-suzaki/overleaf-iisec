// overleaf-lab (rubric sharing prototype, 2026-11-26, owner request):
// deployment-wide SHARED compliance review rubrics.
//
// The existing model stores rubrics inline on the user document
// (User.llmComplianceRubrics) so they are personal. The owner also wants them
// shareable "like the LaTeX template gallery": a searchable gallery of review
// items published by lab members that anyone can copy into their own list.
//
// A shared rubric is a *published snapshot*, not a live link to someone's
// private copy: publishing copies the three fields, so later edits to the
// publisher's personal rubric do not silently change what others imported.
//
// Safe helpers (mirrors LLMReviewJob): a Mongo hiccup must never break the
// review or settings flow — failures are logged and swallowed.
import crypto from 'node:crypto'
import logger from '@overleaf/logger'
// Import the raw mongoose package (side-effect-free) so this module stays
// importable in bare unit tests. In the app it is the SAME default instance
// Overleaf's infrastructure/Mongoose.mjs connects.
import mongoose from 'mongoose'

const { Schema } = mongoose

const LLMRubricShareSchema = new Schema(
    {
        // Stable, public share identifier (a uuid). This is what the gallery
        // lists, imports and updates against; it is independent of the mongo _id
        // and of the publisher's private rubric id.
        shareId: { type: String, required: true, unique: true },
        name: { type: String, default: '' },
        guidelines: { type: String, default: '' },
        scanPatterns: { type: String, default: '' },
        // Attribution so the gallery can show who published each item.
        ownerId: { type: String, required: true, index: true },
        ownerName: { type: String, default: '' },
        // Soft state: an unpublished (deleted) share disappears from the
        // gallery but is kept for auditability.
        active: { type: Boolean, default: true, index: true },
        // Gallery flavor: how many times other users imported this rubric.
        importCount: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
    },
    // bufferCommands off — when the connection is not ready ops reject
    // immediately (and our helpers swallow them) instead of buffering 10s.
    { minimize: false, bufferCommands: false },
)

export const LLMRubricShare = mongoose.model('LLMRubricShare', LLMRubricShareSchema)

export function newShareId() {
    return crypto.randomUUID()
}

// Map a share doc (lean) to the public gallery shape.
function toPublic(doc) {
    if (!doc) return null
    return {
        shareId: doc.shareId,
        name: doc.name || '',
        guidelines: doc.guidelines || '',
        scanPatterns: doc.scanPatterns || '',
        ownerId: doc.ownerId || '',
        ownerName: doc.ownerName || '',
        importCount: doc.importCount || 0,
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    }
}

// List active shares, newest first. Optional case-insensitive text filter on
// name + guidelines (good enough for a prototype gallery search).
export async function listSharedRubrics({ query } = {}) {
    try {
        const filter = { active: true }
        if (query && String(query).trim()) {
            const rx = new RegExp(
                String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                'i',
            )
            filter.$or = [{ name: rx }, { guidelines: rx }]
        }
        const docs = await LLMRubricShare.find(filter)
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(200)
            .lean()
        return docs.map(toPublic)
    } catch (err) {
        logger.error({ err, query }, '[LLM] rubric share: list failed')
        return []
    }
}

// Look up a single active share by id (for the import path).
export async function getSharedRubric(shareId) {
    try {
        const doc = await LLMRubricShare.findOne({ shareId, active: true }).lean()
        return toPublic(doc)
    } catch (err) {
        logger.error({ err, shareId }, '[LLM] rubric share: lookup failed')
        return null
    }
}

// Publish (or republish when the owner passes an existing shareId they own).
// `fields` are already sanitized by the controller (name/guidelines/scanPatterns).
export async function upsertSharedRubric({
    shareId,
    ownerId,
    ownerName,
    fields,
}) {
    try {
        const set = {
            name: fields.name,
            guidelines: fields.guidelines,
            scanPatterns: fields.scanPatterns,
            ownerId,
            ownerName: ownerName || '',
            active: true,
            updatedAt: new Date(),
        }
        const filter = shareId ? { shareId, ownerId } : { shareId: newShareId() }
        const doc = await LLMRubricShare.findOneAndUpdate(
            filter,
            { $set: set, $setOnInsert: { createdAt: new Date() } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean()
        return toPublic(doc)
    } catch (err) {
        logger.error({ err, shareId, ownerId }, '[LLM] rubric share: upsert failed')
        return null
    }
}

// Soft-delete (unpublish). Owner-only enforced by the controller via getShareOwner.
export async function getShareOwner(shareId) {
    try {
        const doc = await LLMRubricShare.findOne({ shareId }).lean()
        return doc ? doc.ownerId : null
    } catch (err) {
        logger.error({ err, shareId }, '[LLM] rubric share: owner lookup failed')
        return null
    }
}

export async function unpublishSharedRubric(shareId, ownerId) {
    try {
        const res = await LLMRubricShare.updateOne(
            { shareId, ownerId, active: true },
            { $set: { active: false, updatedAt: new Date() } },
        )
        return res.modifiedCount > 0
    } catch (err) {
        logger.error({ err, shareId, ownerId }, '[LLM] rubric share: unpublish failed')
        return false
    }
}

// Best-effort popularity bump when someone imports a shared rubric.
export async function recordImport(shareId) {
    try {
        await LLMRubricShare.updateOne(
            { shareId, active: true },
            { $inc: { importCount: 1 }, $set: { updatedAt: new Date() } },
        )
    } catch (err) {
        logger.error({ err, shareId }, '[LLM] rubric share: import bump failed')
    }
}
