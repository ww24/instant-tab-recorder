import { parseApiPath, handleApiRequest, flushStalePersist } from '../src/handler'
import { RecordingState } from '../src/handler'
import type { RecordingStorage } from '../src/storage'
import type { RecordingDB, RecordingRecord } from '../src/recording_db'

// ---------- helpers ----------

function createMockStorage(overrides: Partial<RecordingStorage> = {}): RecordingStorage {
    return {
        list: vi.fn().mockResolvedValue([]),
        getFile: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }),
        ...overrides,
    }
}

function createMockRecordingDB(overrides: Partial<RecordingDB> = {}): RecordingDB {
    return {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(0),
        markStaleRecordingAsCanceled: vi.fn().mockResolvedValue(undefined),
        needsMigration: vi.fn().mockResolvedValue({ needed: false }),
        migrateFromOPFS: vi.fn().mockResolvedValue(0),
        deleteDatabase: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as RecordingDB
}

function createFile(content: string, name: string, type: string): File {
    return new File([content], name, { type })
}

// ---------- parseApiPath ----------

describe('parseApiPath', () => {
    it('should parse /api/storage/estimate', () => {
        expect(parseApiPath('/api/storage/estimate')).toEqual({ route: 'storage-estimate' })
    })

    it('should parse /api/recordings', () => {
        expect(parseApiPath('/api/recordings')).toEqual({ route: 'recordings-list' })
    })

    it('should parse /api/recordings/:name', () => {
        expect(parseApiPath('/api/recordings/test.webm')).toEqual({ route: 'recording', name: 'test.webm' })
    })

    it('should decode percent-encoded names', () => {
        expect(parseApiPath('/api/recordings/my%20video.mp4')).toEqual({ route: 'recording', name: 'my video.mp4' })
    })

    it('should return null for unknown paths', () => {
        expect(parseApiPath('/api/unknown')).toBeNull()
    })

    it('should return null for paths not starting with /api/', () => {
        expect(parseApiPath('/other/path')).toBeNull()
    })

    it('should return null for malformed percent-encoding', () => {
        expect(parseApiPath('/api/recordings/%E0%A4%A')).toBeNull()
    })

    it('should return null for names with encoded forward slash', () => {
        expect(parseApiPath('/api/recordings/foo%2Fbar.webm')).toBeNull()
    })

    it('should return null for names with encoded backslash', () => {
        expect(parseApiPath('/api/recordings/foo%5Cbar.webm')).toBeNull()
    })

    it('should parse /api/recordings/video-{ts}-thumbnail.webp as recording route', () => {
        expect(parseApiPath('/api/recordings/video-1000-thumbnail.webp')).toEqual({
            route: 'recording',
            name: 'video-1000-thumbnail.webp',
        })
    })
})

// ---------- handleApiRequest – storage-estimate ----------

describe('handleApiRequest – storage-estimate', () => {
    it('should return storage estimate on GET', async () => {
        const storage = createMockStorage({
            estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 1048576 }),
        })
        const req = new Request('https://ext.example/api/storage/estimate')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const recordingDB = createMockRecordingDB()
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('application/json')
        expect(await res.json()).toEqual({ usage: 1024, quota: 1048576 })
    })

    it('should return 405 for POST', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/storage/estimate', { method: 'POST' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const recordingDB = createMockRecordingDB()
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recordings-list ----------

describe('handleApiRequest – recordings-list', () => {
    const records: RecordingRecord[] = [
        {
            recordedAt: 1,
            mainFilePath: 'video-1.webm',
            mimeType: 'video/webm',
            title: 'video-1.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
        },
        {
            recordedAt: 2,
            mainFilePath: 'video-2.webm',
            mimeType: 'video/webm',
            title: 'video-2.webm',
            status: 'completed',
            durationMs: 10000,
            fileSize: 200,
            subFiles: [{ path: 'video-2-tab.ogg', type: 'tab', fileSize: 50 }],
        },
        {
            recordedAt: 3,
            mainFilePath: 'video-3.webm',
            mimeType: 'video/webm',
            title: 'video-3.webm',
            status: 'recording',
            durationMs: null,
            fileSize: 0,
            subFiles: [],
        },
    ]
    const recordingState: RecordingState = { isRecording: true, startAtMs: 3 }

    it('should list recordings from IndexedDB on GET', async () => {
        const recordingDB = createMockRecordingDB({ list: vi.fn().mockResolvedValue(records) })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body).toHaveLength(3)
        expect(body[0].title).toBe('video-1.webm')
        expect(body[0].path).toBe('video-1.webm')
        expect(body[0].durationMs).toBe(5000)
        expect(body[1].subFilesSize).toBe(50)
        expect(recordingDB.list).toHaveBeenCalledWith('asc')
    })

    it('should get live file size from OPFS .crswap for recording entries', async () => {
        const recordingDB = createMockRecordingDB({ list: vi.fn().mockResolvedValue(records) })
        const swapFile = createFile('x'.repeat(999), 'video-3.webm.crswap', 'video/webm')
        const storage = createMockStorage({
            getFile: vi.fn().mockImplementation((name: string) => {
                if (name === 'video-3.webm.crswap') return Promise.resolve(swapFile)
                return Promise.resolve(null)
            }),
        })
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        const body = await res.json()
        const recordingEntry = body.find((r: { title: string }) => r.title === 'video-3.webm')
        expect(recordingEntry.size).toBe(999)
        expect(recordingEntry.isRecording).toBe(true)
        expect(storage.getFile).toHaveBeenCalledWith('video-3.webm.crswap')
    })

    it('should fall back to main file when .crswap not found for recording entries', async () => {
        const recordingDB = createMockRecordingDB({ list: vi.fn().mockResolvedValue(records) })
        const mainFile = createFile('y'.repeat(500), 'video-3.webm', 'video/webm')
        const storage = createMockStorage({
            getFile: vi.fn().mockImplementation((name: string) => {
                if (name === 'video-3.webm') return Promise.resolve(mainFile)
                return Promise.resolve(null)
            }),
        })
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        const body = await res.json()
        const recordingEntry = body.find((r: { title: string }) => r.title === 'video-3.webm')
        expect(recordingEntry.size).toBe(500)
    })

    it('should include thumbnailFileName only when thumbnail exists', async () => {
        const withThumbnail: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.webm',
            mimeType: 'video/webm',
            title: 'video-1000.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
            thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
        }
        const withoutThumbnail: RecordingRecord = {
            recordedAt: 1001,
            mainFilePath: 'video-1001.webm',
            mimeType: 'video/webm',
            title: 'video-1001.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
            thumbnail: null,
        }
        const recordingDB = createMockRecordingDB({
            list: vi.fn().mockResolvedValue([withThumbnail, withoutThumbnail]),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, { isRecording: false }, recordingDB)

        expect(res.status).toBe(200)
        const body = await res.json()
        const first = body.find((r: { recordedAt: number }) => r.recordedAt === 1000)
        const second = body.find((r: { recordedAt: number }) => r.recordedAt === 1001)
        expect(first.thumbnailFileName).toBe('video-1000-thumbnail.webp')
        expect(second.thumbnailFileName).toBeUndefined()
    })

    it('should pass sort=desc parameter', async () => {
        const recordingDB = createMockRecordingDB({ list: vi.fn().mockResolvedValue([]) })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings?sort=desc')
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(200)
        expect(recordingDB.list).toHaveBeenCalledWith('desc')
    })

    it('should return 405 for DELETE', async () => {
        const storage = createMockStorage()
        const recordingDB = createMockRecordingDB()
        const req = new Request('https://ext.example/api/recordings', { method: 'DELETE' })
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(405)
    })

    it('should fix stale recording status to canceled when not recording', async () => {
        const staleRecord: RecordingRecord = {
            recordedAt: 10,
            mainFilePath: 'video-10.webm',
            mimeType: 'video/webm',
            title: 'video-10.webm',
            status: 'recording',
            durationMs: null,
            fileSize: 0,
            subFiles: [],
        }
        const putMock = vi.fn().mockResolvedValue(undefined)
        const recordingDB = createMockRecordingDB({
            list: vi.fn().mockResolvedValue([staleRecord]),
            put: putMock,
        })
        const storage = createMockStorage()
        const notRecordingState: RecordingState = { isRecording: false }
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, notRecordingState, recordingDB)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body[0].status).toBe('canceled')
        expect(body[0].isRecording).toBe(false)
        await flushStalePersist()
        expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: 10, status: 'canceled' }))
    })

    it('should not fix recording status when actually recording', async () => {
        const putMock = vi.fn().mockResolvedValue(undefined)
        const recordingDB = createMockRecordingDB({
            list: vi.fn().mockResolvedValue(records),
            put: putMock,
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(200)
        const body = await res.json()
        const recordingEntry = body.find((r: { path: string }) => r.path === 'video-3.webm')
        expect(recordingEntry.status).toBe('recording')
        expect(recordingEntry.isRecording).toBe(true)
        await flushStalePersist()
        expect(putMock).not.toHaveBeenCalled()
    })

    it('should cancel stale recording records that do not match startAtMs', async () => {
        const mixedRecords: RecordingRecord[] = [
            {
                recordedAt: 5,
                mainFilePath: 'video-5.webm',
                mimeType: 'video/webm',
                title: 'video-5.webm',
                status: 'recording',
                durationMs: null,
                fileSize: 0,
                subFiles: [],
            },
            {
                recordedAt: 10,
                mainFilePath: 'video-10.webm',
                mimeType: 'video/webm',
                title: 'video-10.webm',
                status: 'recording',
                durationMs: null,
                fileSize: 0,
                subFiles: [],
            },
        ]
        const putMock = vi.fn().mockResolvedValue(undefined)
        const recordingDB = createMockRecordingDB({
            list: vi.fn().mockResolvedValue(mixedRecords),
            put: putMock,
        })
        const storage = createMockStorage()
        const activeState: RecordingState = { isRecording: true, startAtMs: 10 }
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, activeState, recordingDB)

        expect(res.status).toBe(200)
        const body = await res.json()

        // record 5 should be canceled (stale)
        const stale = body.find((r: { path: string }) => r.path === 'video-5.webm')
        expect(stale.status).toBe('canceled')
        expect(stale.isRecording).toBe(false)

        // record 10 should remain active
        const active = body.find((r: { path: string }) => r.path === 'video-10.webm')
        expect(active.status).toBe('recording')
        expect(active.isRecording).toBe(true)

        // only stale record should have been persisted
        await flushStalePersist()
        expect(putMock).toHaveBeenCalledTimes(1)
        expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: 5, status: 'canceled' }))
    })
})

// ---------- handleApiRequest – recording (GET full) ----------

describe('handleApiRequest – recording GET (full response)', () => {
    it('should return 200 with file contents', async () => {
        const file = createFile('hello world', 'test.webm', 'video/webm')
        const storage = createMockStorage({
            getFile: vi.fn().mockResolvedValue(file),
        })
        const req = new Request('https://ext.example/api/recordings/test.webm')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('video/webm')
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.has('Content-Disposition')).toBe(false)
    })

    it('should add Content-Disposition when download=true', async () => {
        const file = createFile('data', 'my video.mp4', 'video/mp4')
        const storage = createMockStorage({
            getFile: vi.fn().mockResolvedValue(file),
        })
        const req = new Request('https://ext.example/api/recordings/my%20video.mp4?download=true')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Disposition')).toContain('attachment')
    })

    it('should return 404 when file not found', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/missing.webm')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(404)
    })

    it('should return 405 for PUT', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/test.webm', { method: 'PUT' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recording DELETE ----------

describe('handleApiRequest – recording DELETE', () => {
    it('should return 204 on successful delete (no IndexedDB record fallback)', async () => {
        const storage = createMockStorage()
        const recordingDB = createMockRecordingDB()
        const req = new Request('https://ext.example/api/recordings/test.webm', { method: 'DELETE' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(204)
        expect(storage.delete).toHaveBeenCalledWith('test.webm')
    })

    it('should cascade delete sub-files and IndexedDB record', async () => {
        const record: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.webm',
            mimeType: 'video/webm',
            title: 'video-1000.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 12345,
            subFiles: [
                { path: 'video-1000-tab.ogg', type: 'tab', fileSize: 100 },
                { path: 'video-1000-mic.ogg', type: 'mic', fileSize: 200 },
            ],
        }
        const recordingDB = createMockRecordingDB({
            get: vi.fn().mockResolvedValue(record),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/video-1000.webm', { method: 'DELETE' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(204)
        expect(storage.delete).toHaveBeenCalledWith('video-1000-tab.ogg')
        expect(storage.delete).toHaveBeenCalledWith('video-1000-mic.ogg')
        expect(storage.delete).toHaveBeenCalledWith('video-1000.webm')
        expect(recordingDB.delete).toHaveBeenCalledWith(1000)
    })

    it('should return 409 when IndexedDB mainFilePath does not match requested name', async () => {
        const record: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.mp4',
            mimeType: 'video/mp4',
            title: 'video-1000.mp4',
            status: 'completed',
            durationMs: 5000,
            fileSize: 12345,
            subFiles: [],
        }
        const recordingDB = createMockRecordingDB({
            get: vi.fn().mockResolvedValue(record),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/video-1000.webm', { method: 'DELETE' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(409)
        expect(storage.delete).not.toHaveBeenCalled()
        expect(recordingDB.delete).not.toHaveBeenCalled()
    })
})

// ---------- handleApiRequest – recording GET (range requests) ----------

describe('handleApiRequest – recording GET (Range Requests)', () => {
    // Create a 10-byte file for predictable byte content
    const content = '0123456789'
    let file: File
    let storage: RecordingStorage

    beforeEach(() => {
        file = createFile(content, 'test.webm', 'video/webm')
        storage = createMockStorage({
            getFile: vi.fn().mockResolvedValue(file),
        })
    })

    it('should return 206 for valid int-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-4' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-4/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('5')
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.get('Content-Type')).toBe('video/webm')

        const body = await res.text()
        expect(body).toBe('01234')
    })

    it('should return 206 for suffix-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=-3' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 7-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('3')

        const body = await res.text()
        expect(body).toBe('789')
    })

    it('should return 206 for open-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=5-' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 5-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('5')

        const body = await res.text()
        expect(body).toBe('56789')
    })

    it('should clamp end to file size for int-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-99999' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
    })

    it('should return 416 for unsatisfiable range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=100-200' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(416)
        expect(res.headers.get('Content-Range')).toBe(`bytes */${file.size}`)
    })

    it('should return 200 for invalid Range header syntax', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'invalid' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(200)
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
    })

    it('should return 200 for unsupported range unit', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'items=0-5' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(200)
    })

    it('should include Content-Disposition with range response when download=true', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm?download=true', {
            headers: { Range: 'bytes=0-4' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Disposition')).toContain('attachment')
    })

    it('should handle single-byte range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-0' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-0/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('1')

        const body = await res.text()
        expect(body).toBe('0')
    })

    it('should handle last-byte range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=9-9' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 9-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('1')

        const body = await res.text()
        expect(body).toBe('9')
    })

    it('should return 206 with multipart/byteranges for multi-range header', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-2,5-7' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        const contentType = res.headers.get('Content-Type')!
        expect(contentType).toMatch(/^multipart\/byteranges; boundary=/)
        const boundary = contentType.split('boundary=')[1]

        const body = await res.text()
        // Verify multipart structure
        expect(body).toContain(`--${boundary}\r\n`)
        expect(body).toContain(`--${boundary}--\r\n`)

        // Verify first part
        expect(body).toContain('Content-Type: video/webm\r\n')
        expect(body).toContain(`Content-Range: bytes 0-2/${file.size}\r\n`)
        expect(body).toContain('012')

        // Verify second part
        expect(body).toContain(`Content-Range: bytes 5-7/${file.size}\r\n`)
        expect(body).toContain('567')
    })

    it('should return 206 with multipart/byteranges for three ranges', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-1,4-5,8-9' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        const contentType = res.headers.get('Content-Type')!
        expect(contentType).toMatch(/^multipart\/byteranges; boundary=/)
        const boundary = contentType.split('boundary=')[1]

        const body = await res.text()
        // Count boundary occurrences (3 part boundaries + 1 closing)
        const partBoundaries = body.split(`--${boundary}`).length - 1
        expect(partBoundaries).toBe(4) // 3 parts + 1 closing

        expect(body).toContain(`Content-Range: bytes 0-1/${file.size}\r\n`)
        expect(body).toContain(`Content-Range: bytes 4-5/${file.size}\r\n`)
        expect(body).toContain(`Content-Range: bytes 8-9/${file.size}\r\n`)
    })

    it('should return 416 when all ranges in multi-range are unsatisfiable', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=100-200,300-400' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(416)
        expect(res.headers.get('Content-Range')).toBe(`bytes */${file.size}`)
    })

    it('should skip unsatisfiable ranges and serve only satisfiable ones in multipart', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-2,100-200,7-9' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        const contentType = res.headers.get('Content-Type')!
        expect(contentType).toMatch(/^multipart\/byteranges; boundary=/)

        const body = await res.text()
        expect(body).toContain(`Content-Range: bytes 0-2/${file.size}\r\n`)
        expect(body).toContain(`Content-Range: bytes 7-9/${file.size}\r\n`)
        // The unsatisfiable range 100-200 should not appear
        expect(body).not.toContain('Content-Range: bytes 100-')
    })

    it('should return single-range 206 when multi-range has only one satisfiable range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-2,100-200' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        // Should be a single-range response, not multipart
        expect(res.headers.get('Content-Type')).toBe('video/webm')
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-2/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('3')

        const body = await res.text()
        expect(body).toBe('012')
    })

    it('should include Accept-Ranges in multipart response', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { Range: 'bytes=0-2,5-7' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(206)
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    })
})

// ---------- handleApiRequest – not found ----------

describe('handleApiRequest – not found', () => {
    it('should return 404 for unknown API path', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/unknown')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, createMockRecordingDB())

        expect(res.status).toBe(404)
    })
})

// ---------- handleApiRequest – self-healing GET ----------

describe('handleApiRequest – recording GET (self-healing)', () => {
    it('should delete orphaned IndexedDB record when OPFS file not found', async () => {
        const orphanRecord: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.webm',
            mimeType: 'video/webm',
            title: 'video-1000.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
        }
        const recordingDB = createMockRecordingDB({ get: vi.fn().mockResolvedValue(orphanRecord) })
        const storage = createMockStorage({ getFile: vi.fn().mockResolvedValue(null) })
        const req = new Request('https://ext.example/api/recordings/video-1000.webm')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(404)
        expect(recordingDB.delete).toHaveBeenCalledWith(1000)
    })

    it('should not delete IndexedDB record when mainFilePath does not match', async () => {
        const mismatchRecord: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.mp4',
            mimeType: 'video/mp4',
            title: 'video-1000.mp4',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
        }
        const recordingDB = createMockRecordingDB({ get: vi.fn().mockResolvedValue(mismatchRecord) })
        const storage = createMockStorage({ getFile: vi.fn().mockResolvedValue(null) })
        const req = new Request('https://ext.example/api/recordings/video-1000.webm')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(404)
        expect(recordingDB.delete).not.toHaveBeenCalled()
    })
})

// ---------- handleApiRequest – internal error ----------

describe('handleApiRequest – internal error', () => {
    it('should return 500 when recordingDB throws', async () => {
        const recordingDB = createMockRecordingDB({
            list: vi.fn().mockRejectedValue(new Error('disk error')),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    })
})

// ---------- handleApiRequest – recording-thumbnail ----------

describe('handleApiRequest – recording-thumbnail', () => {
    it('should return thumbnail blob with correct content type', async () => {
        const thumbnailBlob = new Blob(['fake-webp'], { type: 'image/webp' })
        const record: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.webm',
            mimeType: 'video/webm',
            title: 'video-1000.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
            thumbnail: thumbnailBlob,
        }
        const recordingDB = createMockRecordingDB({
            get: vi.fn().mockResolvedValue(record),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/video-1000-thumbnail.webp')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('image/webp')
        const body = await res.text()
        expect(body).toBe('fake-webp')
    })

    it('should return 404 when record has no thumbnail', async () => {
        const record: RecordingRecord = {
            recordedAt: 1000,
            mainFilePath: 'video-1000.webm',
            mimeType: 'video/webm',
            title: 'video-1000.webm',
            status: 'completed',
            durationMs: 5000,
            fileSize: 100,
            subFiles: [],
        }
        const recordingDB = createMockRecordingDB({
            get: vi.fn().mockResolvedValue(record),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/video-1000-thumbnail.webp')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(404)
    })

    it('should return 404 when record not found', async () => {
        const recordingDB = createMockRecordingDB({
            get: vi.fn().mockResolvedValue(undefined),
        })
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/video-1000-thumbnail.webp')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(404)
    })

    it('should return 405 for non-GET methods', async () => {
        const recordingDB = createMockRecordingDB()
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/video-1000-thumbnail.webp', {
            method: 'DELETE',
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState, recordingDB)

        expect(res.status).toBe(405)
    })
})
