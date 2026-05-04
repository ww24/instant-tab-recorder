/**
 * REST API handler for recording storage
 *
 * Extracted from service_worker.ts for testability.
 * Implements HTTP Range Requests per RFC 9110 Section 14.
 */

import type { RecordingStorage } from './storage'
import type { RecordingDB, RecordingRecord } from './recording_db'
import { parseRecordedAt } from './recording_db'
import { getMimeTypeFromExtension } from './mime'
import { parseRangeHeader, resolveByteRange, generateBoundary, buildMultipartByteRangesBody } from './range'
import type { ResolvedRange } from './range'
import type { Resolution, VideoRecordingMode } from './configuration'

const API_PREFIX = '/api/'

/**
 * Persist stale-record status fixes to IndexedDB (best-effort, fire-and-forget).
 * Uses a simple flag so that concurrent list requests do not queue up duplicate writes.
 */
let stalePersistPromise: Promise<void> | null = null
function persistStaleRecordFixes(recordingDB: RecordingDB, staleRecords: RecordingRecord[]): void {
    if (stalePersistPromise != null) return
    stalePersistPromise = Promise.all(staleRecords.map(r => recordingDB.put(r)))
        .then(() => undefined)
        .catch(e => console.error('Failed to persist stale record fixes:', e))
        .finally(() => {
            stalePersistPromise = null
        })
}

/** Flush the in-flight stale-persist write (exposed for testing). */
export function _flushStalePersist(): Promise<void> {
    return stalePersistPromise ?? Promise.resolve()
}

/**
 * Parse API path and extract route information
 */
export function parseApiPath(pathname: string): { route: string; name?: string } | null {
    if (!pathname.startsWith(API_PREFIX)) return null

    const path = pathname.slice(API_PREFIX.length)

    // GET /api/storage/estimate
    if (path === 'storage/estimate') {
        return { route: 'storage-estimate' }
    }

    // GET /api/recordings
    if (path === 'recordings') {
        return { route: 'recordings-list' }
    }

    // /api/recordings/:name
    const recordingMatch = path.match(/^recordings\/(.+)$/)
    if (recordingMatch) {
        let name: string
        try {
            name = decodeURIComponent(recordingMatch[1])
        } catch {
            // Malformed percent-encoding in recording name
            return null
        }

        // Reject decoded names containing path separators
        if (name.includes('/') || name.includes('\\')) {
            return null
        }
        return { route: 'recording', name }
    }

    return null
}

export interface RecordingState {
    isRecording: boolean
    isPaused?: boolean
    totalPausedMs?: number
    pausedAtMs?: number
    startAtMs?: number
    screenSize?: Resolution
    recordingMode?: VideoRecordingMode
    micEnabled?: boolean
    stopAtMs?: number
}

/**
 * Handle API requests for recording storage
 *
 * Supports:
 * - GET  /api/storage/estimate              - Storage quota info
 * - GET  /api/recordings                    - List recordings (from IndexedDB)
 * - GET  /api/recordings/:name                    - Download recording (with Range Request support)
 * - GET  /api/recordings/video-{ts}-thumbnail.webp - Get recording thumbnail (served as WebP)
 * - DELETE /api/recordings/:name            - Delete recording (cascade: IndexedDB + OPFS)
 */
export async function handleApiRequest(
    request: Request,
    storage: RecordingStorage,
    state: RecordingState,
    recordingDB: RecordingDB,
): Promise<Response> {
    const url = new URL(request.url)
    const parsed = parseApiPath(url.pathname)

    if (!parsed) {
        return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    try {
        switch (parsed.route) {
            case 'storage-estimate': {
                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const estimate = await storage.estimate()
                return new Response(JSON.stringify(estimate), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            }

            case 'recordings-list': {
                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const sortParam = url.searchParams.get('sort')
                const sort = sortParam === 'desc' ? 'desc' : 'asc'

                const records = await recordingDB.list(sort)
                const staleRecords: typeof records = []
                const recordings = await Promise.all(
                    records.map(async r => {
                        let fileSize = r.fileSize
                        let { status } = r
                        const isDbRecording = status === 'recording'
                        // A record is the active recording only when the service worker
                        // is recording AND this record's timestamp matches startAtMs.
                        const isActiveRecording = isDbRecording && state.isRecording && state.startAtMs === r.recordedAt

                        // Downgrade stale 'recording' entries that are not the active one
                        if (isDbRecording && !isActiveRecording) {
                            status = 'canceled'
                            r.status = status
                            staleRecords.push(r)
                        }

                        // For the active recording, get real-time file size from OPFS
                        // Chrome writes to a .crswap swap file during recording
                        if (isActiveRecording && r.mainFilePath) {
                            const swapFile = await storage.getFile(`${r.mainFilePath}.crswap`)
                            if (swapFile) {
                                fileSize = swapFile.size
                            } else {
                                const file = await storage.getFile(r.mainFilePath)
                                if (file) fileSize = file.size
                            }
                        }

                        const subFilesSize = r.subFiles.reduce((sum, sf) => sum + sf.fileSize, 0)

                        const thumbnailFileName = r.thumbnail ? `video-${r.recordedAt}-thumbnail.webp` : undefined
                        return {
                            title: r.title || r.mainFilePath,
                            path: r.mainFilePath,
                            size: fileSize,
                            lastModified: r.recordedAt,
                            mimeType: r.mimeType,
                            recordedAt: r.recordedAt,
                            isRecording: isActiveRecording,
                            isTemporary: false,
                            durationMs: r.durationMs,
                            status,
                            subFiles: r.subFiles,
                            subFilesSize,
                            ...(thumbnailFileName ? { thumbnailFileName } : {}),
                        }
                    }),
                )

                // Persist stale record fixes in the background (fire-and-forget, best-effort)
                if (staleRecords.length > 0) {
                    persistStaleRecordFixes(recordingDB, staleRecords)
                }

                return new Response(JSON.stringify(recordings), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            }

            case 'recording': {
                const name = parsed.name!
                const mimeType = getMimeTypeFromExtension(name)

                // Thumbnail files are read-only: video-{timestamp}-thumbnail.webp
                const thumbnailMatch = name.match(/^video-([0-9]+)-thumbnail\.webp$/)
                if (thumbnailMatch) {
                    if (request.method !== 'GET') {
                        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                            status: 405,
                            headers: { 'Content-Type': 'application/json' },
                        })
                    }
                    const thumbRecordedAt = Number.parseInt(thumbnailMatch[1], 10)
                    const thumbRecord = await recordingDB.get(thumbRecordedAt)
                    if (!thumbRecord?.thumbnail) {
                        return new Response(JSON.stringify({ error: 'Not Found' }), {
                            status: 404,
                            headers: { 'Content-Type': 'application/json' },
                        })
                    }
                    return new Response(thumbRecord.thumbnail, {
                        status: 200,
                        headers: { 'Content-Type': mimeType },
                    })
                }

                if (request.method === 'DELETE') {
                    // Look up IndexedDB record by timestamp for cascade delete
                    const recordedAt = parseRecordedAt(name)
                    const record = recordedAt != null ? await recordingDB.get(recordedAt) : undefined
                    if (record) {
                        // Verify that the requested file name matches the stored mainFilePath
                        if (record.mainFilePath !== name) {
                            return new Response(JSON.stringify({ error: 'Recording path mismatch' }), {
                                status: 409,
                                headers: { 'Content-Type': 'application/json' },
                            })
                        }
                        if (record.status === 'recording') {
                            return new Response(
                                JSON.stringify({
                                    error: 'This file cannot be deleted because it is currently being recorded.',
                                }),
                                { status: 409 },
                            )
                        }
                        // Delete sub-files and main file from OPFS (idempotent)
                        await Promise.all([
                            ...record.subFiles.map(sub => storage.delete(sub.path)),
                            storage.delete(record.mainFilePath),
                        ])
                        // Delete IndexedDB record
                        await recordingDB.delete(record.recordedAt)
                    } else {
                        // Fallback: no IndexedDB record (sub-file or pre-migration)
                        await storage.delete(name)
                    }
                    return new Response(null, { status: 204 })
                }

                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }

                // GET /api/recordings/:name - return binary file
                const file = await storage.getFile(name)
                if (!file) {
                    // Self-healing: clean up orphaned IndexedDB record
                    const recordedAt = parseRecordedAt(name)
                    if (recordedAt != null) {
                        try {
                            const orphan = await recordingDB.get(recordedAt)
                            if (orphan && orphan.mainFilePath === name) {
                                await recordingDB.delete(recordedAt)
                            }
                        } catch (e) {
                            console.error('Failed to clean up orphaned recording record:', e)
                        }
                    }
                    return new Response(JSON.stringify({ error: 'Not Found' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const headers: Record<string, string> = {
                    'Content-Type': mimeType,
                    'Accept-Ranges': 'bytes',
                }
                // Add Content-Disposition header only when download=true is specified
                if (url.searchParams.get('download') === 'true') {
                    const encodedName = encodeURIComponent(name).replace(/'/g, '%27')
                    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodedName}`
                }

                // Handle Range requests (RFC 9110 Section 14)
                const rangeHeader = request.headers.get('Range')
                if (rangeHeader) {
                    const rangeResult = parseRangeHeader(rangeHeader)
                    if (rangeResult && rangeResult.type === 'bytes' && rangeResult.ranges.length > 0) {
                        // Resolve all ranges; collect satisfiable ones
                        const resolvedRanges: ResolvedRange[] = []
                        for (const spec of rangeResult.ranges) {
                            const resolved = resolveByteRange(spec, file.size)
                            if (resolved) {
                                resolvedRanges.push(resolved)
                            }
                        }

                        if (resolvedRanges.length === 0) {
                            // No satisfiable ranges (RFC 9110 Section 15.3.7)
                            return new Response(null, {
                                status: 416,
                                headers: {
                                    ...headers,
                                    'Content-Range': `bytes */${file.size}`,
                                },
                            })
                        }

                        if (resolvedRanges.length === 1) {
                            // Single satisfiable range
                            const { start, end } = resolvedRanges[0]
                            const contentLength = end - start + 1
                            headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`
                            headers['Content-Length'] = contentLength.toString()
                            return new Response(file.slice(start, end + 1), {
                                status: 206,
                                headers,
                            })
                        }

                        // Multiple satisfiable ranges → multipart/byteranges (RFC 9110 Section 14.6)
                        const boundary = generateBoundary()
                        const body = await buildMultipartByteRangesBody(file, resolvedRanges, mimeType, boundary)
                        return new Response(body.buffer, {
                            status: 206,
                            headers: {
                                ...headers,
                                'Content-Type': `multipart/byteranges; boundary=${boundary}`,
                                'Content-Length': body.byteLength.toString(),
                            },
                        })
                    }
                    // If range is syntactically invalid or unsupported unit,
                    // ignore and return full response (RFC 9110 Section 14.2)
                }

                // Full response
                headers['Content-Length'] = file.size.toString()
                return new Response(file, {
                    status: 200,
                    headers,
                })
            }

            default:
                return new Response(JSON.stringify({ error: 'Not Found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                })
        }
    } catch (e) {
        console.error('API error:', e)
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}
