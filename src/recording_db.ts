import type { RecordingSortOrder } from './configuration'
import type { RecordingStorage } from './storage'

const DB_NAME = 'instant-tab-recorder'
const DB_VERSION = 1
const STORE_NAME = 'recordings'

const timestampRegex = /^video-([0-9]+)\./
const subFileRegex = /^video-([0-9]+)-(tab|mic)\./

/** .crswap swap files created by Chrome during recording */
const crswapExp = '.crswap'

/**
 * Extract the recordedAt timestamp from a file name like "video-1234567890.webm".
 * Returns undefined if the name doesn't match.
 */
export function parseRecordedAt(fileName: string): number | undefined {
    const m = fileName.match(timestampRegex)
    return m ? Number.parseInt(m[1], 10) : undefined
}

export interface SubFileInfo {
    path: string
    type: 'tab' | 'mic'
    fileSize: number
}

export interface RecordingRecord {
    /** Primary key: recording start timestamp (ms) */
    recordedAt: number
    /** OPFS file path (e.g. "video-1234567890.webm") */
    mainFilePath: string
    /** MIME type (e.g. "video/webm") */
    mimeType: string
    /** Display title (initially same as mainFilePath, can be renamed later) */
    title: string
    /** "recording" while in progress, "completed" when done, "canceled" if recording was interrupted */
    status: 'recording' | 'completed' | 'canceled'
    /** Duration in ms, null while recording or pending migration */
    durationMs: number | null
    /** Main file size in bytes (0 while recording) */
    fileSize: number
    /** Sub-files (tab audio, mic audio) */
    subFiles: SubFileInfo[]
    /** WebP thumbnail blob, null when generation failed, undefined for legacy records */
    thumbnail?: Blob | null
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.addEventListener('upgradeneeded', () => {
            const db = request.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'recordedAt' })
            }
        })
        request.addEventListener('success', () => resolve(request.result))
        request.addEventListener('error', () => reject(request.error))
    })
}

export type MigrationStatus = { needed: false } | { needed: true; opfsMainFileCount: number; idbRecordCount: number }

export class RecordingDB {
    private dbPromise: Promise<IDBDatabase> | null = null

    private getDB(): Promise<IDBDatabase> {
        if (this.dbPromise == null) {
            this.dbPromise = openDB().catch(e => {
                this.dbPromise = null
                throw e
            })
        }
        return this.dbPromise
    }

    async put(record: RecordingRecord): Promise<void> {
        const db = await this.getDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).put(record)
            tx.addEventListener('complete', () => resolve())
            tx.addEventListener('error', () => reject(tx.error))
            tx.addEventListener('abort', () => reject(tx.error))
        })
    }

    async get(recordedAt: number): Promise<RecordingRecord | undefined> {
        const db = await this.getDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const request = tx.objectStore(STORE_NAME).get(recordedAt)
            request.addEventListener('success', () => resolve(request.result as RecordingRecord | undefined))
            request.addEventListener('error', () => reject(request.error))
            tx.addEventListener('abort', () => reject(tx.error))
        })
    }

    async list(sort: RecordingSortOrder = 'asc'): Promise<RecordingRecord[]> {
        const db = await this.getDB()
        const direction: IDBCursorDirection = sort === 'desc' ? 'prev' : 'next'
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const request = tx.objectStore(STORE_NAME).openCursor(null, direction)
            const results: RecordingRecord[] = []
            request.addEventListener('success', () => {
                const cursor = request.result
                if (cursor) {
                    results.push(cursor.value as RecordingRecord)
                    cursor.continue()
                } else {
                    resolve(results)
                }
            })
            request.addEventListener('error', () => reject(request.error))
            tx.addEventListener('abort', () => reject(tx.error))
        })
    }

    async delete(recordedAt: number): Promise<void> {
        const db = await this.getDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).delete(recordedAt)
            tx.addEventListener('complete', () => resolve())
            tx.addEventListener('error', () => reject(tx.error))
            tx.addEventListener('abort', () => reject(tx.error))
        })
    }

    async count(): Promise<number> {
        const db = await this.getDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const request = tx.objectStore(STORE_NAME).count()
            request.addEventListener('success', () => resolve(request.result))
            request.addEventListener('error', () => reject(request.error))
            tx.addEventListener('abort', () => reject(tx.error))
        })
    }

    /**
     * Find the most recent record with status "recording" and mark it as "canceled".
     * Used to clean up stale records from interrupted recordings.
     */
    async markStaleRecordingAsCanceled(): Promise<void> {
        const records = await this.list('desc')
        const stale = records.find(r => r.status === 'recording')
        if (stale == null) return
        stale.status = 'canceled'
        await this.put(stale)
    }

    /**
     * Check whether OPFS → IndexedDB migration is needed.
     * Migration is needed when IndexedDB has fewer records than OPFS main files.
     */
    async needsMigration(opfsStorage: RecordingStorage): Promise<MigrationStatus> {
        const files = await opfsStorage.list()
        let opfsMainFileCount = 0
        for (const file of files) {
            if (file.isTemporary) continue
            if (file.title.endsWith(crswapExp)) continue
            if (timestampRegex.test(file.title) && !subFileRegex.test(file.title)) {
                opfsMainFileCount++
            }
        }
        const idbRecordCount = await this.count()
        if (idbRecordCount >= opfsMainFileCount) {
            return { needed: false }
        }
        return { needed: true, opfsMainFileCount, idbRecordCount }
    }

    /**
     * Migrate existing OPFS recordings into IndexedDB.
     * Idempotent: skips recordings that already have an IndexedDB record.
     * Call {@link needsMigration} first to check whether migration is needed.
     * @returns The number of new records inserted.
     */
    async migrateFromOPFS(opfsStorage: RecordingStorage): Promise<number> {
        const files = await opfsStorage.list()

        // Group files by startAtMs
        const mainFiles = new Map<number, { name: string; size: number; mimeType: string }>()
        const subFilesMap = new Map<number, SubFileInfo[]>()

        for (const file of files) {
            if (file.isTemporary) continue
            if (file.title.endsWith(crswapExp)) continue

            const subMatch = file.title.match(subFileRegex)
            if (subMatch) {
                const ts = Number.parseInt(subMatch[1], 10)
                const type = subMatch[2] as 'tab' | 'mic'
                const arr = subFilesMap.get(ts) ?? []
                arr.push({ path: file.title, type, fileSize: file.size })
                subFilesMap.set(ts, arr)
                continue
            }

            const mainMatch = file.title.match(timestampRegex)
            if (mainMatch) {
                const ts = Number.parseInt(mainMatch[1], 10)
                mainFiles.set(ts, { name: file.title, size: file.size, mimeType: file.mimeType })
            }
        }

        // Bulk-fetch existing keys to avoid N+1 get() calls
        const existingRecords = await this.list()
        const existingKeys = new Set(existingRecords.map(r => r.recordedAt))

        let inserted = 0
        for (const [recordedAt, { name, size, mimeType }] of mainFiles) {
            if (existingKeys.has(recordedAt)) continue

            const record: RecordingRecord = {
                recordedAt,
                mainFilePath: name,
                mimeType,
                title: name,
                status: 'completed',
                durationMs: null,
                fileSize: size,
                subFiles: subFilesMap.get(recordedAt) ?? [],
            }
            await this.put(record)
            inserted++
        }
        return inserted
    }

    /**
     * Close the database connection, releasing the held IDBDatabase handle.
     */
    async close(): Promise<void> {
        if (this.dbPromise != null) {
            const db = await this.dbPromise
            db.close()
            this.dbPromise = null
        }
    }

    /**
     * Delete the database entirely. Used for testing.
     */
    async deleteDatabase(): Promise<void> {
        await this.close()
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME)
            request.addEventListener('success', () => resolve())
            request.addEventListener('error', () => reject(request.error))
        })
    }
}
