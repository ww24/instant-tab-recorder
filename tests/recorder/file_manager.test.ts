vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import { FileManager } from '../../src/recorder/file_manager'

// ---------- OPFS mocks ----------

const mockWritableStream = {
    write: vi.fn(),
    close: vi.fn(),
    abort: vi.fn(),
} as unknown as FileSystemWritableFileStream

const mockFileHandle = {
    createWritable: vi.fn().mockResolvedValue(mockWritableStream),
    getFile: vi.fn().mockResolvedValue(new File([], 'test.webm')),
} as unknown as FileSystemFileHandle

const mockDirHandle = {
    getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
} as unknown as FileSystemDirectoryHandle

// Mock navigator.storage
const origStorage = globalThis.navigator
beforeAll(() => {
    Object.defineProperty(globalThis, 'navigator', {
        value: {
            ...origStorage,
            storage: {
                getDirectory: vi.fn().mockResolvedValue(mockDirHandle),
            },
        },
        configurable: true,
    })
})

beforeEach(() => {
    vi.clearAllMocks()
})

// ---------- FileManager ----------

describe('FileManager', () => {
    describe('createRecordingFile', () => {
        test('creates file with correct name for webm container', async () => {
            const fm = new FileManager()
            const result = await fm.createRecordingFile(1234567890, 'webm')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-1234567890.webm', { create: true })
            expect(result).toBe(mockFileHandle)
        })

        test('creates file with correct name for mp4 container', async () => {
            const fm = new FileManager()
            const result = await fm.createRecordingFile(9999, 'mp4')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-9999.mp4', { create: true })
            expect(result).toBe(mockFileHandle)
        })

        test('creates file with correct name for ogg container', async () => {
            const fm = new FileManager()
            const result = await fm.createRecordingFile(5555, 'ogg')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-5555.ogg', { create: true })
            expect(result).toBe(mockFileHandle)
        })
    })

    describe('createAudioFile', () => {
        test('creates audio file with given fileName', async () => {
            const fm = new FileManager()
            const result = await fm.createAudioFile('video-1000-tab.ogg')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-1000-tab.ogg', { create: true })
            expect(result).toBe(mockFileHandle)
        })
    })

    describe('directory access', () => {
        test('calls getDirectory for each operation', async () => {
            const fm = new FileManager()
            await fm.createRecordingFile(1, 'webm')
            await fm.createAudioFile('test.ogg')

            expect(navigator.storage.getDirectory).toHaveBeenCalledTimes(2)
        })
    })
})
