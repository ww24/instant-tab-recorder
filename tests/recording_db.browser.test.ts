import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RecordingDB, type RecordingRecord } from '../src/recording_db'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<RecordingRecord> & { recordedAt: number }): RecordingRecord {
    return {
        mainFilePath: `video-${overrides.recordedAt}.webm`,
        mimeType: 'video/webm',
        title: `video-${overrides.recordedAt}.webm`,
        status: 'completed',
        durationMs: null,
        fileSize: 1024,
        subFiles: [],
        ...overrides,
    }
}

// ---------------------------------------------------------------------------
// Integration tests using real IndexedDB
// ---------------------------------------------------------------------------

describe('RecordingDB (real IndexedDB)', () => {
    let db: RecordingDB

    beforeEach(() => {
        db = new RecordingDB()
    })

    afterEach(async () => {
        await db.deleteDatabase()
    })

    // ---- put / get ----

    it('put then get returns the same record', async () => {
        const record = makeRecord({ recordedAt: 1000, fileSize: 5000, durationMs: 3000 })
        await db.put(record)

        const result = await db.get(1000)
        expect(result).toEqual(record)
    })

    it('get returns undefined for non-existent key', async () => {
        const result = await db.get(9999)
        expect(result).toBeUndefined()
    })

    it('put overwrites existing record with same key', async () => {
        const record = makeRecord({ recordedAt: 1000, status: 'recording', fileSize: 0 })
        await db.put(record)

        const updated = { ...record, status: 'completed' as const, fileSize: 5000, durationMs: 3000 }
        await db.put(updated)

        const result = await db.get(1000)
        expect(result).toEqual(updated)
    })

    it('stores and retrieves subFiles correctly', async () => {
        const record = makeRecord({
            recordedAt: 2000,
            subFiles: [
                { path: 'video-2000-tab.ogg', type: 'tab', fileSize: 100 },
                { path: 'video-2000-mic.ogg', type: 'mic', fileSize: 200 },
            ],
        })
        await db.put(record)

        const result = await db.get(2000)
        expect(result?.subFiles).toHaveLength(2)
        expect(result?.subFiles).toEqual(
            expect.arrayContaining([
                { path: 'video-2000-tab.ogg', type: 'tab', fileSize: 100 },
                { path: 'video-2000-mic.ogg', type: 'mic', fileSize: 200 },
            ]),
        )
    })

    it('stores and retrieves thumbnail blob', async () => {
        const thumbnailBlob = new Blob(['fake-jpeg'], { type: 'image/jpeg' })
        const record = makeRecord({ recordedAt: 3000, thumbnail: thumbnailBlob })
        await db.put(record)

        const result = await db.get(3000)
        expect(result?.thumbnail).toBeInstanceOf(Blob)
        expect(result?.thumbnail?.type).toBe('image/jpeg')
        const text = await result!.thumbnail!.text()
        expect(text).toBe('fake-jpeg')
    })

    it('stores record with null thumbnail', async () => {
        const record = makeRecord({ recordedAt: 4000, thumbnail: null })
        await db.put(record)

        const result = await db.get(4000)
        expect(result?.thumbnail).toBeNull()
    })

    it('returns undefined thumbnail for legacy records without thumbnail', async () => {
        const record = makeRecord({ recordedAt: 5000 })
        await db.put(record)

        const result = await db.get(5000)
        expect(result?.thumbnail).toBeUndefined()
    })

    // ---- list ----

    it('list returns empty array when DB is empty', async () => {
        const result = await db.list()
        expect(result).toEqual([])
    })

    it('list returns records sorted by recordedAt ascending', async () => {
        await db.put(makeRecord({ recordedAt: 300 }))
        await db.put(makeRecord({ recordedAt: 100 }))
        await db.put(makeRecord({ recordedAt: 200 }))

        const result = await db.list('asc')
        expect(result.map(r => r.recordedAt)).toEqual([100, 200, 300])
    })

    it('list returns records sorted by recordedAt descending', async () => {
        await db.put(makeRecord({ recordedAt: 300 }))
        await db.put(makeRecord({ recordedAt: 100 }))
        await db.put(makeRecord({ recordedAt: 200 }))

        const result = await db.list('desc')
        expect(result.map(r => r.recordedAt)).toEqual([300, 200, 100])
    })

    it('list defaults to ascending order', async () => {
        await db.put(makeRecord({ recordedAt: 200 }))
        await db.put(makeRecord({ recordedAt: 100 }))

        const result = await db.list()
        expect(result.map(r => r.recordedAt)).toEqual([100, 200])
    })

    // ---- delete ----

    it('delete removes a record by key', async () => {
        await db.put(makeRecord({ recordedAt: 1000 }))
        await db.put(makeRecord({ recordedAt: 2000 }))

        await db.delete(1000)

        expect(await db.get(1000)).toBeUndefined()
        expect(await db.get(2000)).toBeDefined()
    })

    it('delete is idempotent for non-existent key', async () => {
        // Should not throw
        await db.delete(9999)
    })

    // ---- count ----

    it('count returns 0 for empty DB', async () => {
        expect(await db.count()).toBe(0)
    })

    it('count returns the number of records', async () => {
        await db.put(makeRecord({ recordedAt: 100 }))
        await db.put(makeRecord({ recordedAt: 200 }))
        await db.put(makeRecord({ recordedAt: 300 }))

        expect(await db.count()).toBe(3)
    })

    it('count reflects deletes', async () => {
        await db.put(makeRecord({ recordedAt: 100 }))
        await db.put(makeRecord({ recordedAt: 200 }))
        await db.delete(100)

        expect(await db.count()).toBe(1)
    })

    // ---- markStaleRecordingAsCanceled ----

    it('markStaleRecordingAsCanceled changes the first "recording" to "canceled"', async () => {
        await db.put(makeRecord({ recordedAt: 100, status: 'completed' }))
        await db.put(makeRecord({ recordedAt: 200, status: 'recording' }))
        await db.put(makeRecord({ recordedAt: 300, status: 'recording' }))

        await db.markStaleRecordingAsCanceled()

        // list('desc') returns 300 first; markStale finds the first "recording" = 300
        const r300 = await db.get(300)
        expect(r300?.status).toBe('canceled')

        // 200 remains "recording" (only one is marked per call)
        const r200 = await db.get(200)
        expect(r200?.status).toBe('recording')
    })

    it('markStaleRecordingAsCanceled does nothing when no "recording" exists', async () => {
        await db.put(makeRecord({ recordedAt: 100, status: 'completed' }))
        await db.put(makeRecord({ recordedAt: 200, status: 'canceled' }))

        await db.markStaleRecordingAsCanceled()

        expect((await db.get(100))?.status).toBe('completed')
        expect((await db.get(200))?.status).toBe('canceled')
    })

    // ---- close / reopen ----

    it('close then subsequent operations reopen the DB transparently', async () => {
        await db.put(makeRecord({ recordedAt: 1000 }))
        await db.close()

        // After close, the next operation should reopen the connection
        const result = await db.get(1000)
        expect(result?.recordedAt).toBe(1000)
    })

    // ---- migrateFromOPFS ----

    it('migrateFromOPFS inserts records from OPFS file list', async () => {
        const mockStorage = {
            list: async () => [
                {
                    title: 'video-100.webm',
                    size: 1000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
                {
                    title: 'video-100-tab.flac',
                    size: 100,
                    lastModified: Date.now(),
                    mimeType: 'audio/flac',
                    isTemporary: false,
                },
                {
                    title: 'video-200.webm',
                    size: 2000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
            ],
            getFile: async () => null,
            delete: async () => {},
            estimate: async () => ({ usage: 0, quota: 0 }),
        }

        const inserted = await db.migrateFromOPFS(mockStorage)
        expect(inserted).toBe(2)

        const r100 = await db.get(100)
        expect(r100).toBeDefined()
        expect(r100?.mainFilePath).toBe('video-100.webm')
        expect(r100?.subFiles).toEqual([{ path: 'video-100-tab.flac', type: 'tab', fileSize: 100 }])

        const r200 = await db.get(200)
        expect(r200).toBeDefined()
        expect(r200?.subFiles).toEqual([])
    })

    it('migrateFromOPFS is idempotent on second call', async () => {
        const mockStorage = {
            list: async () => [
                {
                    title: 'video-100.webm',
                    size: 1000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
            ],
            getFile: async () => null,
            delete: async () => {},
            estimate: async () => ({ usage: 0, quota: 0 }),
        }

        const first = await db.migrateFromOPFS(mockStorage)
        expect(first).toBe(1)

        const second = await db.migrateFromOPFS(mockStorage)
        expect(second).toBe(0)

        expect(await db.count()).toBe(1)
    })

    it('migrateFromOPFS skips .crswap and temporary files', async () => {
        const mockStorage = {
            list: async () => [
                {
                    title: 'video-100.webm',
                    size: 1000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
                {
                    title: 'video-100.webm.crswap',
                    size: 0,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
                {
                    title: 'video-200.webm',
                    size: 2000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: true,
                },
            ],
            getFile: async () => null,
            delete: async () => {},
            estimate: async () => ({ usage: 0, quota: 0 }),
        }

        const inserted = await db.migrateFromOPFS(mockStorage)
        expect(inserted).toBe(1)
        expect(await db.count()).toBe(1)
        expect(await db.get(100)).toBeDefined()
        expect(await db.get(200)).toBeUndefined()
    })

    // ---- needsMigration ----

    it('needsMigration returns needed:true when IDB is empty and OPFS has files', async () => {
        const mockStorage = {
            list: async () => [
                {
                    title: 'video-100.webm',
                    size: 1000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
                {
                    title: 'video-200.webm',
                    size: 2000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
            ],
            getFile: async () => null,
            delete: async () => {},
            estimate: async () => ({ usage: 0, quota: 0 }),
        }

        const status = await db.needsMigration(mockStorage)
        expect(status).toEqual({ needed: true, opfsMainFileCount: 2, idbRecordCount: 0 })
    })

    it('needsMigration returns needed:false after migration', async () => {
        const mockStorage = {
            list: async () => [
                {
                    title: 'video-100.webm',
                    size: 1000,
                    lastModified: Date.now(),
                    mimeType: 'video/webm',
                    isTemporary: false,
                },
            ],
            getFile: async () => null,
            delete: async () => {},
            estimate: async () => ({ usage: 0, quota: 0 }),
        }

        await db.migrateFromOPFS(mockStorage)

        const status = await db.needsMigration(mockStorage)
        expect(status).toEqual({ needed: false })
    })

    // ---- concurrent operations ----

    it('handles concurrent put operations on different keys', async () => {
        await Promise.all([
            db.put(makeRecord({ recordedAt: 100 })),
            db.put(makeRecord({ recordedAt: 200 })),
            db.put(makeRecord({ recordedAt: 300 })),
        ])

        expect(await db.count()).toBe(3)
        const list = await db.list('asc')
        expect(list.map(r => r.recordedAt)).toEqual([100, 200, 300])
    })

    it('handles concurrent list and put operations', async () => {
        await db.put(makeRecord({ recordedAt: 100 }))

        const [listResult] = await Promise.all([db.list(), db.put(makeRecord({ recordedAt: 200 }))])

        // list may or may not include the concurrently inserted record
        expect(listResult.length).toBeGreaterThanOrEqual(1)

        // But after both complete, both records should be present
        expect(await db.count()).toBe(2)
    })
})
