import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    extractModelRelativePath,
    OPFSCache,
    downloadWhisperModel,
    WHISPER_MODEL_FILES,
    WHISPER_TOTAL_BYTES,
} from '../../src/transcription/opfs_cache'

describe('extractModelRelativePath', () => {
    it('extracts filename from Hugging Face resolve URL', () => {
        expect(
            extractModelRelativePath(
                'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/config.json',
            ),
        ).toBe('config.json')

        expect(
            extractModelRelativePath(
                'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/encoder_model_fp16.onnx',
            ),
        ).toBe('onnx/encoder_model_fp16.onnx')
    })

    it('handles URLs with query strings or hashes', () => {
        expect(
            extractModelRelativePath(
                'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/tokenizer.json?download=true#frag',
            ),
        ).toBe('tokenizer.json')
    })

    it('extracts filename from local or relative repository paths', () => {
        expect(
            extractModelRelativePath('models/onnx-community/whisper-large-v3-turbo/onnx/decoder_model_merged_q4.onnx'),
        ).toBe('onnx/decoder_model_merged_q4.onnx')

        expect(extractModelRelativePath('whisper-large-v3-turbo/generation_config.json')).toBe('generation_config.json')
    })

    it('matches known Whisper files as direct fallback', () => {
        expect(extractModelRelativePath('preprocessor_config.json')).toBe('preprocessor_config.json')
        expect(extractModelRelativePath('onnx/encoder_model_fp16.onnx')).toBe('onnx/encoder_model_fp16.onnx')
    })

    it('returns null for unrelated paths', () => {
        expect(extractModelRelativePath('https://example.com/unrelated/file.txt')).toBeNull()
        expect(extractModelRelativePath('some/random/path.bin')).toBeNull()
    })
})

describe('OPFSCache', () => {
    let mockFiles: Map<string, { size: number; content: Uint8Array }>
    let mockRoot: any

    function createMockDirectory(name = 'root'): any {
        const entries = new Map<string, any>()
        return {
            kind: 'directory',
            name,
            getDirectoryHandle: vi.fn(async (subName: string, options?: { create?: boolean }) => {
                if (entries.has(subName)) {
                    return entries.get(subName)
                }
                if (options?.create) {
                    const subDir = createMockDirectory(subName)
                    entries.set(subName, subDir)
                    return subDir
                }
                throw new Error(`Directory ${subName} not found`)
            }),
            getFileHandle: vi.fn(async (fileName: string, options?: { create?: boolean }) => {
                if (entries.has(fileName)) {
                    return entries.get(fileName)
                }
                if (options?.create) {
                    const fileHandle = {
                        kind: 'file',
                        name: fileName,
                        getFile: vi.fn(async () => {
                            const data = mockFiles.get(fileName) || { size: 0, content: new Uint8Array(0) }
                            const file = new File([data.content], fileName)
                            Object.defineProperty(file, 'size', { value: data.size, configurable: true })
                            return file
                        }),
                        createWritable: vi.fn(async () => {
                            const chunks: Uint8Array[] = []
                            return {
                                write: vi.fn(async (chunk: Uint8Array) => {
                                    chunks.push(chunk)
                                }),
                                close: vi.fn(async () => {
                                    const total = chunks.reduce((s, c) => s + c.byteLength, 0)
                                    const merged = new Uint8Array(total)
                                    let offset = 0
                                    for (const c of chunks) {
                                        merged.set(c, offset)
                                        offset += c.byteLength
                                    }
                                    mockFiles.set(fileName, { size: total, content: merged })
                                }),
                                abort: vi.fn(),
                            }
                        }),
                    }
                    entries.set(fileName, fileHandle)
                    return fileHandle
                }
                throw new Error(`File ${fileName} not found`)
            }),
            removeEntry: vi.fn(async (entryName: string) => {
                entries.delete(entryName)
            }),
            entries: vi.fn(async function* () {
                for (const [k, v] of entries.entries()) {
                    yield [k, v]
                }
            }),
        }
    }

    beforeEach(() => {
        mockFiles = new Map()
        mockRoot = createMockDirectory('root')
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: vi.fn().mockResolvedValue(mockRoot),
            },
        })
    })

    it('matches cached file and returns Response with Content-Length', async () => {
        const cache = new OPFSCache()
        const fileHandle = await cache.getFileHandle('config.json', true)
        expect(fileHandle).not.toBeNull()

        mockFiles.set('config.json', {
            size: 100,
            content: new TextEncoder().encode('{"test": true}'),
        })

        const response = await cache.match(
            'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/config.json',
        )
        expect(response).toBeDefined()
        expect(response?.status).toBe(200)
        expect(response?.headers.get('content-type')).toBe('application/json')
        expect(response?.headers.get('content-length')).toBe('100')
        const json = await response?.json()
        expect(json).toEqual({ test: true })
    })

    it('returns undefined on cache miss', async () => {
        const cache = new OPFSCache()
        const response = await cache.match(
            'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/config.json',
        )
        expect(response).toBeUndefined()
    })

    it('hasModel returns true only when all 7 files exist and are non-empty', async () => {
        const cache = new OPFSCache()
        expect(await cache.hasModel()).toBe(false)

        for (const entry of WHISPER_MODEL_FILES) {
            await cache.getFileHandle(entry.path, true)
            mockFiles.set(entry.path.split('/').pop()!, {
                size: entry.size,
                content: new Uint8Array(10),
            })
        }

        expect(await cache.hasModel()).toBe(true)
    })

    it('getTotalSize calculates the total bytes of present files', async () => {
        const cache = new OPFSCache()
        for (const entry of WHISPER_MODEL_FILES) {
            await cache.getFileHandle(entry.path, true)
            mockFiles.set(entry.path.split('/').pop()!, {
                size: entry.size,
                content: new Uint8Array(10),
            })
        }

        const size = await cache.getTotalSize()
        expect(size).toBe(WHISPER_TOTAL_BYTES)
    })

    it('clear removes model directory and legacy directory', async () => {
        const cache = new OPFSCache()
        await cache.getModelDirectory(true)
        await cache.clear()
        expect(mockRoot.removeEntry).toHaveBeenCalled()
    })
})

describe('downloadWhisperModel', () => {
    let mockFiles: Map<string, { size: number; content: Uint8Array }>
    let mockRoot: any

    function createMockDirectory(name = 'root'): any {
        const entries = new Map<string, any>()
        return {
            kind: 'directory',
            name,
            getDirectoryHandle: vi.fn(async (subName: string, options?: { create?: boolean }) => {
                if (entries.has(subName)) {
                    return entries.get(subName)
                }
                if (options?.create) {
                    const subDir = createMockDirectory(subName)
                    entries.set(subName, subDir)
                    return subDir
                }
                throw new Error(`Directory ${subName} not found`)
            }),
            getFileHandle: vi.fn(async (fileName: string, options?: { create?: boolean }) => {
                if (entries.has(fileName)) {
                    return entries.get(fileName)
                }
                if (options?.create) {
                    const fileHandle = {
                        kind: 'file',
                        name: fileName,
                        getFile: vi.fn(async () => {
                            const data = mockFiles.get(fileName) || { size: 0, content: new Uint8Array(0) }
                            const file = new File([data.content], fileName)
                            Object.defineProperty(file, 'size', { value: data.size, configurable: true })
                            return file
                        }),
                        createWritable: vi.fn(async () => {
                            const chunks: Uint8Array[] = []
                            return {
                                write: vi.fn(async (chunk: Uint8Array) => {
                                    chunks.push(chunk)
                                }),
                                close: vi.fn(async () => {
                                    const total = chunks.reduce((s, c) => s + c.byteLength, 0)
                                    const merged = new Uint8Array(total)
                                    let offset = 0
                                    for (const c of chunks) {
                                        merged.set(c, offset)
                                        offset += c.byteLength
                                    }
                                    mockFiles.set(fileName, { size: total, content: merged })
                                }),
                                abort: vi.fn(),
                            }
                        }),
                    }
                    entries.set(fileName, fileHandle)
                    return fileHandle
                }
                throw new Error(`File ${fileName} not found`)
            }),
            removeEntry: vi.fn(async (entryName: string) => {
                entries.delete(entryName)
            }),
            entries: vi.fn(async function* () {
                for (const [k, v] of entries.entries()) {
                    yield [k, v]
                }
            }),
        }
    }

    beforeEach(() => {
        mockFiles = new Map()
        mockRoot = createMockDirectory('root')
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: vi.fn().mockResolvedValue(mockRoot),
            },
        })
    })

    it('downloads all files and reports progress from 0 to 100', async () => {
        const progressUpdates: number[] = []

        // Mock fetch with small dummy streams
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string) => {
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new Uint8Array(100))
                        controller.close()
                    },
                })
                return new Response(stream, { status: 200 })
            }),
        )

        const cache = new OPFSCache()
        await downloadWhisperModel(progress => {
            progressUpdates.push(progress.progress)
        }, cache)

        expect(progressUpdates.length).toBeGreaterThan(0)
        expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
        expect(await cache.hasModel()).toBe(true)
    })

    it('throws error and cleans up when fetch fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                return new Response(null, { status: 404, statusText: 'Not Found' })
            }),
        )

        const cache = new OPFSCache()
        await expect(downloadWhisperModel(undefined, cache)).rejects.toThrow('HTTP 404')
    })
})
