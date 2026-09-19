import { describe, it, expect, vi, afterEach } from 'vitest'
import { OPFSModelCache } from '../src/ml/opfs_model_cache'
import { REQUIRED_TRANSCRIPTION_MODEL_FILES } from '../src/transcription/model_files'
import { getModelFileUrl, type RequiredModelFile } from '../src/ml/model_files'

const TEST_CACHE_DIR = 'test-model-cache'

interface MockStorageItem {
    size?: number
    sha256?: string
    file?: File
}

type MockFileEntry = MockStorageItem | File | number | string

function setupMockStorage(mockFiles: Map<string, MockFileEntry> | null) {
    if (mockFiles === null) {
        Object.defineProperty(globalThis, 'navigator', {
            value: { storage: undefined },
            writable: true,
            configurable: true,
        })
        return
    }

    vi.spyOn(OPFSModelCache.prototype, 'calculateFileHash').mockImplementation(async (file: File) => {
        const item = mockFiles.get(file.name)
        if (item instanceof File) {
            const buffer = await item.arrayBuffer()
            const digest = await crypto.subtle.digest('SHA-256', buffer)
            return Array.from(new Uint8Array(digest))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')
        }
        if (typeof item === 'string') {
            return item
        }
        if (item && typeof item === 'object' && 'sha256' in item && item.sha256) {
            return item.sha256
        }
        return ''
    })

    const cacheDirHandle: Partial<FileSystemDirectoryHandle> = {
        getFileHandle: vi.fn(async (name: string) => {
            if (!mockFiles.has(name)) {
                throw new Error(`File not found: ${name}`)
            }
            const entry = mockFiles.get(name)!
            let file: File
            if (entry instanceof File) {
                file = entry
            } else if (typeof entry === 'number') {
                file = { name, size: entry } as unknown as File
            } else if (typeof entry === 'string') {
                file = { name, size: 0 } as unknown as File
            } else {
                file = entry.file ?? ({ name, size: entry.size ?? 0 } as unknown as File)
            }
            const fileHandle: Partial<FileSystemFileHandle> = {
                getFile: async () => file,
            }
            return fileHandle as FileSystemFileHandle
        }),
    }

    const rootHandle: Partial<FileSystemDirectoryHandle> = {
        getDirectoryHandle: vi.fn(async (name: string) => {
            if (name === TEST_CACHE_DIR) {
                return cacheDirHandle as FileSystemDirectoryHandle
            }
            throw new Error(`Directory not found: ${name}`)
        }),
    }

    Object.defineProperty(globalThis, 'navigator', {
        value: {
            storage: {
                getDirectory: vi.fn(async () => rootHandle as FileSystemDirectoryHandle),
            },
        },
        writable: true,
        configurable: true,
    })
}

describe('OPFSModelCache.hasCache', () => {
    const originalNavigator = globalThis.navigator

    afterEach(() => {
        vi.restoreAllMocks()
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            writable: true,
            configurable: true,
        })
    })

    it('returns false when storage.getDirectory is not supported', async () => {
        setupMockStorage(null)
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns false when directory has only one file left behind from failed download', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, number>()

        // Add only the first file
        const firstFile = REQUIRED_TRANSCRIPTION_MODEL_FILES[0]
        const fileName = await cache.getCacheFileName(getModelFileUrl(firstFile))
        files.set(fileName, firstFile.size)

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns false when some files exist but not all required artifacts', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, number>()

        // Add half of the files
        for (let i = 0; i < Math.floor(REQUIRED_TRANSCRIPTION_MODEL_FILES.length / 2); i++) {
            const file = REQUIRED_TRANSCRIPTION_MODEL_FILES[i]
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.size)
        }

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns false when all files exist but one has incorrect size (truncated download)', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, number>()

        for (const file of REQUIRED_TRANSCRIPTION_MODEL_FILES) {
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.size)
        }

        // Corrupt the size of the large encoder model
        const encoderFile = REQUIRED_TRANSCRIPTION_MODEL_FILES.find(f => f.name.includes('encoder'))!
        const encoderFileName = await cache.getCacheFileName(getModelFileUrl(encoderFile))
        files.set(encoderFileName, 1024) // incomplete size

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns true when every required artifact exists with its expected size', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, number>()

        for (const file of REQUIRED_TRANSCRIPTION_MODEL_FILES) {
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.size)
        }

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(true)
    })

    it('returns false when requiredFiles is empty array', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, [])
        setupMockStorage(new Map())
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('works with custom requiredFiles list', async () => {
        const customFiles: RequiredModelFile[] = [
            { repo: 'custom/repo', revision: 'rev1', name: 'model.bin', size: 1000, sha256: '0'.repeat(64) },
        ]
        const cache = new OPFSModelCache(TEST_CACHE_DIR, customFiles)
        const files = new Map<string, number>()
        const fileName = await cache.getCacheFileName(getModelFileUrl(customFiles[0]))
        files.set(fileName, 1000)

        setupMockStorage(files)
        expect(await cache.hasCache()).toBe(true)

        // Change size to mismatch
        files.set(fileName, 999)
        expect(await cache.hasCache()).toBe(false)
    })
})

describe('OPFSModelCache.verifyCache', () => {
    const originalNavigator = globalThis.navigator
    const originalCrypto = globalThis.crypto

    afterEach(() => {
        vi.restoreAllMocks()
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            writable: true,
            configurable: true,
        })
        Object.defineProperty(globalThis, 'crypto', {
            value: originalCrypto,
            writable: true,
            configurable: true,
        })
    })

    it('returns false when storage.getDirectory is not supported', async () => {
        setupMockStorage(null)
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const result = await cache.verifyCache()
        expect(result).toBe(false)
    })

    it('returns false when crypto.subtle is not supported', async () => {
        setupMockStorage(new Map())
        Object.defineProperty(globalThis, 'crypto', {
            value: { subtle: undefined },
            writable: true,
            configurable: true,
        })
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const result = await cache.verifyCache()
        expect(result).toBe(false)
    })

    it('returns false when directory has only one file left behind from failed download', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, string>()

        // Add only the first file
        const firstFile = REQUIRED_TRANSCRIPTION_MODEL_FILES[0]
        const fileName = await cache.getCacheFileName(getModelFileUrl(firstFile))
        files.set(fileName, firstFile.sha256)

        setupMockStorage(files)
        const result = await cache.verifyCache()
        expect(result).toBe(false)
    })

    it('returns false when some files exist but not all required artifacts', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, string>()

        // Add half of the files
        for (let i = 0; i < Math.floor(REQUIRED_TRANSCRIPTION_MODEL_FILES.length / 2); i++) {
            const file = REQUIRED_TRANSCRIPTION_MODEL_FILES[i]
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.sha256)
        }

        setupMockStorage(files)
        const result = await cache.verifyCache()
        expect(result).toBe(false)
    })

    it('returns false when all files exist but one has incorrect hash (corrupted download)', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, string>()

        for (const file of REQUIRED_TRANSCRIPTION_MODEL_FILES) {
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.sha256)
        }

        // Corrupt the hash of the large encoder model
        const encoderFile = REQUIRED_TRANSCRIPTION_MODEL_FILES.find(f => f.name.includes('encoder'))!
        const encoderFileName = await cache.getCacheFileName(getModelFileUrl(encoderFile))
        files.set(encoderFileName, '0'.repeat(64)) // incorrect hash

        setupMockStorage(files)
        const result = await cache.verifyCache()
        expect(result).toBe(false)
    })

    it('returns true when every required artifact exists with its expected hash', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const files = new Map<string, string>()

        for (const file of REQUIRED_TRANSCRIPTION_MODEL_FILES) {
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.sha256)
        }

        setupMockStorage(files)
        const result = await cache.verifyCache()
        expect(result).toBe(true)
    })

    it('returns false when requiredFiles is empty array', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, [])
        setupMockStorage(new Map())
        const result = await cache.verifyCache()
        expect(result).toBe(false)
    })

    it('works with custom requiredFiles list and computes real hash', async () => {
        const content = new TextEncoder().encode('valid model content')
        const digest = await crypto.subtle.digest('SHA-256', content)
        const expectedHash = Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')

        const customFiles: RequiredModelFile[] = [
            { repo: 'custom/repo', revision: 'rev1', name: 'model.bin', size: content.length, sha256: expectedHash },
        ]
        const cache = new OPFSModelCache(TEST_CACHE_DIR, customFiles)
        const fileName = await cache.getCacheFileName(getModelFileUrl(customFiles[0]))
        const files = new Map<string, File>()
        files.set(fileName, new File([content], fileName))

        setupMockStorage(files)
        vi.mocked(OPFSModelCache.prototype.calculateFileHash).mockRestore()

        expect(await cache.verifyCache()).toBe(true)

        // Change content to mismatch
        files.set(fileName, new File([new TextEncoder().encode('corrupted content')], fileName))
        expect(await cache.verifyCache()).toBe(false)
    })
})

describe('OPFSModelCache.calculateFileHash', () => {
    it('calculates sha-256 hash of a file correctly with calculateFileHash', async () => {
        const cache = new OPFSModelCache(TEST_CACHE_DIR, [])
        const content = new TextEncoder().encode('hello world')
        const file = new File([content], 'hello.txt')
        const hash = await cache.calculateFileHash(file)
        expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    })
})
