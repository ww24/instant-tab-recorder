import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordingApiClient, recordingApi } from '../src/api_client'
import type { TranscriptionResult } from '../src/transcription/types'

describe('RecordingApiClient', () => {
    let client: RecordingApiClient
    let originalFetch: typeof globalThis.fetch
    let originalNavigator: typeof globalThis.navigator
    let originalChrome: unknown

    let controllerChangeListeners: Array<() => void> = []
    let mockController: { postMessage?: () => void } | null = {}

    beforeEach(() => {
        client = new RecordingApiClient()
        originalFetch = globalThis.fetch
        originalNavigator = globalThis.navigator
        originalChrome = (globalThis as unknown as { chrome: unknown }).chrome

        controllerChangeListeners = []
        mockController = {}

        // Mock navigator.serviceWorker
        const mockServiceWorker = {
            get controller() {
                return mockController
            },
            ready: Promise.resolve({}),
            addEventListener: vi.fn((event: string, listener: () => void) => {
                if (event === 'controllerchange') {
                    controllerChangeListeners.push(listener)
                }
            }),
            removeEventListener: vi.fn((event: string, listener: () => void) => {
                if (event === 'controllerchange') {
                    controllerChangeListeners = controllerChangeListeners.filter(l => l !== listener)
                }
            }),
        }

        Object.defineProperty(globalThis, 'navigator', {
            value: {
                ...globalThis.navigator,
                serviceWorker: mockServiceWorker,
            },
            configurable: true,
            writable: true,
        })

        // Mock chrome.runtime.sendMessage
        ;(globalThis as unknown as { chrome: unknown }).chrome = {
            runtime: {
                sendMessage: vi.fn().mockImplementation(async () => {
                    mockController = {}
                    for (const listener of controllerChangeListeners) {
                        listener()
                    }
                }),
            },
        }
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            configurable: true,
            writable: true,
        })
        ;(globalThis as unknown as { chrome: unknown }).chrome = originalChrome
        vi.restoreAllMocks()
    })

    describe('ensureControlled', () => {
        it('claims clients when controller is initially null', async () => {
            mockController = null
            const sendMessageMock = vi.fn().mockImplementation(async () => {
                mockController = {}
                for (const listener of controllerChangeListeners) {
                    listener()
                }
            })
            ;(
                globalThis as unknown as { chrome: { runtime: { sendMessage: typeof sendMessageMock } } }
            ).chrome.runtime.sendMessage = sendMessageMock

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ text: '', segments: [] }),
            } as unknown as Response)

            await client.getTranscription('test.webm')

            expect(sendMessageMock).toHaveBeenCalledWith({ type: 'claim-clients' })
            expect(globalThis.fetch).toHaveBeenCalled()
        })

        it('can be called directly via client.ensureControlled', async () => {
            mockController = {}
            await expect(client.ensureControlled()).resolves.toBeUndefined()
        })
    })

    describe('getTranscription', () => {
        it('returns transcription data when status is 200', async () => {
            const mockTranscription: TranscriptionResult = {
                transcribedAt: 1234567890,
                modelId: 'openai/whisper-tiny',
                language: 'en',
                segments: [
                    {
                        startSec: 0,
                        endSec: 1.5,
                        text: 'Hello world',
                    },
                ],
            }

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockTranscription,
            } as unknown as Response)

            const result = await client.getTranscription('recording-123.webm')

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/recordings/recording-123.webm/transcription')
            expect(result).toEqual(mockTranscription)
        })

        it('properly encodes file name in URL', async () => {
            const mockTranscription: TranscriptionResult = {
                transcribedAt: 1234567890,
                modelId: 'openai/whisper-tiny',
                language: 'en',
                segments: [],
            }
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockTranscription,
            } as unknown as Response)

            await client.getTranscription('folder/test recording #1.webm')

            expect(globalThis.fetch).toHaveBeenCalledWith(
                `/api/recordings/${encodeURIComponent('folder/test recording #1.webm')}/transcription`,
            )
        })

        it('returns null when status is 404', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            } as unknown as Response)

            const result = await client.getTranscription('non-existent.webm')

            expect(result).toBeNull()
        })

        it('throws an error when status is not ok (e.g. 500)', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
            } as unknown as Response)

            await expect(client.getTranscription('error.webm')).rejects.toThrow('Failed to get transcription: 500')
        })
    })

    describe('saveTranscription', () => {
        it('succeeds when status is 204', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 204,
            } as unknown as Response)

            const transcription: TranscriptionResult = {
                transcribedAt: 1234567890,
                modelId: 'openai/whisper-tiny',
                language: 'en',
                segments: [{ startSec: 0, endSec: 1, text: 'Saved text' }],
            }

            await client.saveTranscription('test.webm', transcription)

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/recordings/test.webm/transcription', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(transcription),
            })
        })

        it('succeeds when status is 200', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
            } as unknown as Response)

            const transcription: TranscriptionResult = {
                transcribedAt: 1234567890,
                modelId: 'openai/whisper-tiny',
                language: 'en',
                segments: [],
            }
            await expect(client.saveTranscription('test.webm', transcription)).resolves.toBeUndefined()
        })

        it('throws an error when status is not ok', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
            } as unknown as Response)

            const transcription: TranscriptionResult = {
                transcribedAt: 1234567890,
                modelId: 'openai/whisper-tiny',
                language: 'en',
                segments: [],
            }
            await expect(client.saveTranscription('test.webm', transcription)).rejects.toThrow(
                'Failed to save transcription: 400',
            )
        })
    })

    describe('deleteTranscription', () => {
        it('succeeds when status is 204', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 204,
            } as unknown as Response)

            await client.deleteTranscription('test.webm')

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/recordings/test.webm/transcription', {
                method: 'DELETE',
            })
        })

        it('succeeds when status is 200', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
            } as unknown as Response)

            await expect(client.deleteTranscription('test.webm')).resolves.toBeUndefined()
        })

        it('throws an error when status is not ok', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
            } as unknown as Response)

            await expect(client.deleteTranscription('test.webm')).rejects.toThrow('Failed to delete transcription: 500')
        })
    })

    describe('existing methods', () => {
        it('listRecordings sends sort param and returns data', async () => {
            const recordings = [{ title: 'rec1', path: 'rec1.webm' }]
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => recordings,
            } as unknown as Response)

            const result = await client.listRecordings({ sort: 'desc' })
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/recordings?sort=desc')
            expect(result).toEqual(recordings)
        })

        it('getRecordingFile returns blob on success and null on 404', async () => {
            const blob = new Blob(['test'])
            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => blob,
            } as unknown as Response)

            const result = await client.getRecordingFile('rec1.webm')
            expect(result).toEqual(blob)

            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: false,
                status: 404,
            } as unknown as Response)

            const nullResult = await client.getRecordingFile('rec404.webm')
            expect(nullResult).toBeNull()
        })

        it('deleteRecording succeeds on 204 and throws on error', async () => {
            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                status: 204,
            } as unknown as Response)

            await expect(client.deleteRecording('rec1.webm')).resolves.toBeUndefined()

            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: false,
                status: 500,
            } as unknown as Response)

            await expect(client.deleteRecording('rec1.webm')).rejects.toThrow('Failed to delete recording: 500')
        })

        it('getStorageEstimate returns estimate data', async () => {
            const estimate = { usage: 100, quota: 1000 }
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => estimate,
            } as unknown as Response)

            const result = await client.getStorageEstimate()
            expect(result).toEqual(estimate)
        })

        it('getContentLength returns parsed number on 200 with header', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Length': '12345' }),
            } as unknown as Response)

            const result = await client.getContentLength('/api/test')
            expect(result).toBe(12345)
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/test', { method: 'HEAD' })
        })

        it('getContentLength returns null on non-ok or missing header', async () => {
            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: false,
                status: 404,
                headers: new Headers(),
            } as unknown as Response)

            expect(await client.getContentLength('/api/missing')).toBeNull()

            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers(),
            } as unknown as Response)

            expect(await client.getContentLength('/api/no-length')).toBeNull()
        })

        it('getFileStream returns response.body stream on success', async () => {
            const mockStream = new ReadableStream()
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                body: mockStream,
            } as unknown as Response)

            const controller = new AbortController()
            const result = await client.getFileStream('/api/file', controller.signal)
            expect(result).toBe(mockStream)
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/file', { signal: controller.signal })
        })

        it('getFileStream returns null on error or empty body', async () => {
            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: false,
                status: 500,
                body: null,
            } as unknown as Response)

            expect(await client.getFileStream('/api/error')).toBeNull()

            globalThis.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: null,
            } as unknown as Response)

            expect(await client.getFileStream('/api/no-body')).toBeNull()
        })
    })

    describe('recordingApi default instance', () => {
        it('is an instance of RecordingApiClient', () => {
            expect(recordingApi).toBeInstanceOf(RecordingApiClient)
        })
    })
})
