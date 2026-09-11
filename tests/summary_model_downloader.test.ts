import { describe, it, expect } from 'vitest'
import { SUMMARY_MODEL_CACHE_DIR, SummaryModelDownloader } from '../src/summary/model_downloader'
import { REQUIRED_SUMMARY_MODEL_FILES, SUMMARY_MODEL_REPO } from '../src/summary/model_files'
import { getModelFileUrl } from '../src/ml/model_files'
import { OPFSModelCache } from '../src/ml/opfs_model_cache'

describe('SummaryModelDownloader', () => {
    it('REQUIRED_SUMMARY_MODEL_FILES contains valid files, positive sizes, and sha256 hashes', () => {
        expect(REQUIRED_SUMMARY_MODEL_FILES.length).toBeGreaterThan(0)
        for (const file of REQUIRED_SUMMARY_MODEL_FILES) {
            expect(file.repo).toBe(SUMMARY_MODEL_REPO)
            expect(file.revision).toBeTruthy()
            expect(file.name).toBeTruthy()
            expect(file.size).toBeGreaterThan(0)
            expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
        }
    })

    it('REQUIRED_SUMMARY_MODEL_FILES contains Gemma 4 text-only ONNX files', () => {
        const fileNames = REQUIRED_SUMMARY_MODEL_FILES.map(f => f.name)
        expect(fileNames).toContain('config.json')
        expect(fileNames).toContain('tokenizer.json')
        expect(fileNames).toContain('tokenizer_config.json')
        expect(fileNames).toContain('onnx/decoder_model_merged_q4f16.onnx')
        expect(fileNames).toContain('onnx/decoder_model_merged_q4f16.onnx_data')
        expect(fileNames).toContain('onnx/embed_tokens_q4f16.onnx')
    })

    it('getModelFileUrl produces valid HuggingFace resolve URLs', () => {
        const configFile = REQUIRED_SUMMARY_MODEL_FILES.find(f => f.name === 'config.json')!
        const url = getModelFileUrl(configFile)
        expect(url).toBe(`https://huggingface.co/${configFile.repo}/resolve/${configFile.revision}/${configFile.name}`)
    })

    it('download URL and runtime inference URL normalize to identical cache keys', () => {
        const cache = new OPFSModelCache(SUMMARY_MODEL_CACHE_DIR, REQUIRED_SUMMARY_MODEL_FILES)
        const configFile = REQUIRED_SUMMARY_MODEL_FILES.find(f => f.name === 'config.json')!
        const downloadUrl = getModelFileUrl(configFile)
        const runtimeUrl = `https://huggingface.co/${SUMMARY_MODEL_REPO}/resolve/main/${configFile.name}`

        expect(cache.normalizeKey(downloadUrl)).toBe(
            `${GEMMA_SUMMARY_REPO_PLACEHOLDER(configFile.repo)}/${configFile.name}`,
        )
        expect(cache.normalizeKey(downloadUrl)).toBe(cache.normalizeKey(runtimeUrl))
    })

    it('getTotalSize returns sum of all required summary model file sizes', () => {
        const expectedTotal = REQUIRED_SUMMARY_MODEL_FILES.reduce((sum, f) => sum + f.size, 0)
        expect(SummaryModelDownloader.getTotalSize()).toBe(expectedTotal)
        expect(SummaryModelDownloader.getTotalSize()).toBeGreaterThan(2.9 * 1024 * 1024 * 1024)
        expect(SummaryModelDownloader.getTotalSize()).toBeLessThan(3.0 * 1024 * 1024 * 1024)
    })

    it('getFormattedTotalSize formats total size properly', () => {
        expect(SummaryModelDownloader.getFormattedTotalSize(1)).toBe('2.9 GB')
        expect(SummaryModelDownloader.getFormattedTotalSize(2)).toBe('2.92 GB')
    })
})

function GEMMA_SUMMARY_REPO_PLACEHOLDER(repo: string): string {
    return repo
}
