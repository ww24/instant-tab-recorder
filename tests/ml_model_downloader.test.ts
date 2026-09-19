import { describe, it, expect, vi } from 'vitest'
import { BaseModelDownloader } from '../src/ml/model_downloader'
import type { ModelCache } from '../src/ml/model_cache'
import type { RequiredModelFile } from '../src/ml/model_files'

const createMockCache = (existingMatch = false): ModelCache => ({
    normalizeKey: vi.fn(k => k),
    getCacheFileName: vi.fn(async k => `cache_${k}`),
    match: vi.fn(async req => {
        if (!existingMatch) return undefined
        const url = typeof req === 'string' ? req : req.url
        const size = url.includes('model.onnx') ? '5000' : '1000'
        return new Response(new Uint8Array(Number(size)), {
            headers: { 'Content-Length': size },
        })
    }),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => true),
    clear: vi.fn(async () => {}),
    hasCache: vi.fn(async () => true),
    verifyCache: vi.fn(async () => true),
})

describe('BaseModelDownloader', () => {
    const sampleFiles: readonly RequiredModelFile[] = [
        { repo: 'test/model', revision: 'main', name: 'config.json', size: 1000, sha256: '0'.repeat(64) },
        { repo: 'test/model', revision: 'main', name: 'model.onnx', size: 5000, sha256: '1'.repeat(64) },
    ]

    it('calculates total size correctly', () => {
        const downloader = new BaseModelDownloader(sampleFiles, { cache: createMockCache() })
        expect(downloader.getTotalSize()).toBe(6000)
        expect(downloader.getFormattedTotalSize()).toBe('5.9 KB')
    })

    it('verifyCache delegates to cache with files', async () => {
        const cache = createMockCache()
        const downloader = new BaseModelDownloader(sampleFiles, { cache })
        const result = await downloader.verifyCache()
        expect(result).toBe(true)
        expect(cache.verifyCache).toHaveBeenCalledWith(sampleFiles)
    })

    it('download calls verifyCache upon completion', async () => {
        const cache = createMockCache(true)
        const downloader = new BaseModelDownloader(sampleFiles, { cache })
        await downloader.download()
        expect(cache.verifyCache).toHaveBeenCalledWith(sampleFiles)
    })

    it('download throws if verifyCache returns false upon completion', async () => {
        const cache = createMockCache(true)
        cache.verifyCache = vi.fn(async () => false)
        const downloader = new BaseModelDownloader(sampleFiles, { cache })
        await expect(downloader.download()).rejects.toThrow('Model download completed with missing or incomplete files')
    })

    it('clearCache delegates to cache.clear', async () => {
        const cache = createMockCache()
        const downloader = new BaseModelDownloader(sampleFiles, { cache })
        await downloader.clearCache()
        expect(cache.clear).toHaveBeenCalledTimes(1)
    })

    it('abort sets aborted flag', () => {
        const downloader = new BaseModelDownloader(sampleFiles, { cache: createMockCache() })
        expect(downloader.aborted).toBe(false)
        downloader.abort()
        expect(downloader.aborted).toBe(true)
    })
})
