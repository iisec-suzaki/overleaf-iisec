// overleaf-lab (owner request 2026-11-26): MCP usage meter — data-volume
// accounting for the personal-mcp read/write tools.
//
// Mirrors LLMUsage.mjs design goals (kept deliberately small):
//   * ONE capture point: PersonalMcpServer.callTool records whatever the tool
//     moved (bytes read out / bytes written in) plus who/which token/tool.
//   * NON-FATAL: a missing/broken usage store must never break an MCP call.
//     Every Mongo op is wrapped; errors are logged and swallowed.
//   * READS are aggregate-backed and bounded (per-token / per-user), so the
//     pages stay fast even with a large history.
import logger from '@overleaf/logger'
// overleaf-lab: raw mongoose (same default instance the app connects), importable
// in bare unit tests. See LLMUsage / LLMReviewJob for the same pattern.
import mongoose from 'mongoose'

const { Schema } = mongoose

const PersonalMcpUsageSchema = new Schema(
    {
        userId: { type: String, default: null, index: true },
        tokenId: { type: String, default: null, index: true },
        tool: { type: String, default: '' }, // read_doc | list_projects | create_doc | update_doc | upload_file | ...
        direction: { type: String, default: 'read' }, // 'read' | 'write'
        bytes: { type: Number, default: 0 }, // data moved: read payload size | write input size
        ok: { type: Boolean, default: true },
        day: { type: String, default: '' }, // local date bucket 'YYYY-MM-DD' for cheap grouping
        createdAt: { type: Date, default: Date.now },
    },
    { minimize: false, bufferCommands: false },
)

export const PersonalMcpUsage = mongoose.model('PersonalMcpUsage', PersonalMcpUsageSchema)

// day bucketing uses the server's local day (single-machine deployment; matches
// LLMUsage expectations and the "30 days" default on the UI).
function dayBucket(d = new Date()) {
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function num(v) {
    return Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0
}

// overleaf-lab: record one MCP tool call's data volume. Fire-and-forget safe:
// the returned promise never rejects.
export function recordMcpUsage(meta) {
    const job = (async () => {
        const m = meta || {}
        await PersonalMcpUsage.create({
            userId:
                m.userId != null && String(m.userId).length > 12
                    ? String(m.userId).slice(0, 60)
                    : null,
            tokenId:
                m.tokenId != null && String(m.tokenId).length > 12
                    ? String(m.tokenId).slice(0, 60)
                    : null,
            tool: String(m.tool || '').slice(0, 40),
            direction: m.direction === 'write' ? 'write' : 'read',
            bytes: num(m.bytes),
            ok: m.ok !== false,
            day: dayBucket(),
            createdAt: new Date(),
        })
    })()
    return job.catch(err => {
        logger.debug({ err }, '[PersonalMcpUsage] record failed (non-fatal)')
    })
}

function windowFilter({ userId, days = 30 }) {
    const limit = Math.min(Math.max(Number(days) || 30, 1), 365)
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (limit - 1))
    const filter = {
        createdAt: { $gte: from },
        ...(userId != null ? { userId: String(userId) } : {}),
    }
    return { limit, filter }
}

// Fold one aggregate row's read/write split into a flat bucket shape.
function foldDirection(rows, keyField) {
    return rows.map(r => ({
        [keyField]: r._id,
        calls: r.calls || 0,
        readCalls: r.readCalls || 0,
        writeCalls: r.writeCalls || 0,
        readBytes: r.readBytes || 0,
        writeBytes: r.writeBytes || 0,
        totalBytes: (r.readBytes || 0) + (r.writeBytes || 0),
    }))
}

// Direction-split accumulator stages shared by per-token / per-user groups.
const DIRECTION_ACCUM = {
    calls: { $sum: 1 },
    readCalls: { $sum: { $cond: [{ $eq: ['$direction', 'read'] }, 1, 0] } },
    writeCalls: { $sum: { $cond: [{ $eq: ['$direction', 'write'] }, 1, 0] } },
    readBytes: { $sum: { $cond: [{ $eq: ['$direction', 'read'] }, '$bytes', 0] } },
    writeBytes: { $sum: { $cond: [{ $eq: ['$direction', 'write'] }, '$bytes', 0] } },
}

// overleaf-lab: aggregate one user's MCP data volume, grouped per token.
// Returns { days, tokens:[{tokenId, calls, read/write Calls, read/write/total Bytes}], totals }
// or null when the store is unreachable.
export async function summarizeByToken(userId, { days = 30 } = {}) {
    try {
        const { limit, filter } = windowFilter({ userId, days })
        const [perToken, tot] = await Promise.all([
            PersonalMcpUsage.aggregate([
                { $match: filter },
                { $group: { _id: '$tokenId', ...DIRECTION_ACCUM } },
                { $sort: { '_id': 1 } },
            ]),
            PersonalMcpUsage.aggregate([
                { $match: filter },
                { $group: { _id: null, ...DIRECTION_ACCUM } },
            ]),
        ])
        return {
            days: limit,
            tokens: foldDirection(perToken, 'tokenId'),
            totals: (tot[0] && foldDirection([{ _id: null, ...tot[0] }], '_')[0]) || {
                calls: 0, readCalls: 0, writeCalls: 0, readBytes: 0, writeBytes: 0, totalBytes: 0,
            },
        }
    } catch (err) {
        logger.debug({ err }, '[PersonalMcpUsage] by-token summary failed (non-fatal)')
        return null
    }
}

// overleaf-lab: aggregate MCP data volume across the whole site, grouped per user
// (for the admin usage page). Returns { days, users:[{userId, ...}], totals } or null.
export async function summarizeByUser({ days = 30 } = {}) {
    try {
        const { limit, filter } = windowFilter({ days })
        const [perUser, tot] = await Promise.all([
            PersonalMcpUsage.aggregate([
                { $match: filter },
                { $group: { _id: '$userId', ...DIRECTION_ACCUM } },
                { $sort: { totalBytes: -1 } },
                { $limit: 200 },
            ]),
            PersonalMcpUsage.aggregate([
                { $match: filter },
                { $group: { _id: null, ...DIRECTION_ACCUM } },
            ]),
        ])
        return {
            days: limit,
            users: foldDirection(perUser, 'userId'),
            totals: (tot[0] && foldDirection([{ _id: null, ...tot[0] }], '_')[0]) || {
                calls: 0, readCalls: 0, writeCalls: 0, readBytes: 0, writeBytes: 0, totalBytes: 0,
            },
        }
    } catch (err) {
        logger.debug({ err }, '[PersonalMcpUsage] by-user summary failed (non-fatal)')
        return null
    }
}

export { dayBucket }
