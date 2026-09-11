import { describe, it, expect } from 'vitest'
import { TRANSCRIPTION_MODEL_CACHE_DIR, TranscriptionModelDownloader } from '../src/transcription/model_downloader'
import {
    REQUIRED_TRANSCRIPTION_MODEL_FILES,
    VAD_MODEL_REPO,
    TRANSCRIPTION_MODEL_REPO,
} from '../src/transcription/model_files'
import { getModelFileUrl } from '../src/ml/model_files'
import { OPFSModelCache } from '../src/ml/opfs_model_cache'

describe('ModelDownloader', () => {
    it('REQUIRED_MODEL_FILES contains valid files, positive sizes, and sha256 hashes', () => {
        expect(REQUIRED_TRANSCRIPTION_MODEL_FILES.length).toBeGreaterThan(0)
        for (const file of REQUIRED_TRANSCRIPTION_MODEL_FILES) {
            expect(file.repo).toBeTruthy()
            expect(file.revision).toBeTruthy()
            expect(file.name).toBeTruthy()
            expect(file.size).toBeGreaterThan(0)
            expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
        }
    })

    it('REQUIRED_MODEL_FILES contains both Whisper and Silero VAD model files', () => {
        const whisperFiles = REQUIRED_TRANSCRIPTION_MODEL_FILES.filter(f => f.repo === TRANSCRIPTION_MODEL_REPO)
        const vadFiles = REQUIRED_TRANSCRIPTION_MODEL_FILES.filter(f => f.repo === VAD_MODEL_REPO)

        expect(whisperFiles.length).toBe(7)
        expect(vadFiles.length).toBe(1)
        expect(vadFiles[0].name).toBe('onnx/model.onnx')
    })

    it('getModelFileUrl produces valid HuggingFace resolve URLs', () => {
        const vadFile = REQUIRED_TRANSCRIPTION_MODEL_FILES.find(f => f.repo === VAD_MODEL_REPO)!
        const url = getModelFileUrl(vadFile)
        expect(url).toBe(`https://huggingface.co/${vadFile.repo}/resolve/${vadFile.revision}/${vadFile.name}`)
    })

    it('download URL and runtime inference URL normalize to identical cache keys', () => {
        const cache = new OPFSModelCache(TRANSCRIPTION_MODEL_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES)
        const vadFile = REQUIRED_TRANSCRIPTION_MODEL_FILES.find(f => f.repo === VAD_MODEL_REPO)!
        const downloadUrl = getModelFileUrl(vadFile)
        const runtimeUrl = `https://huggingface.co/${VAD_MODEL_REPO}/resolve/main/${vadFile.name}`

        expect(cache.normalizeKey(downloadUrl)).toBe(`${VAD_MODEL_REPO}/${vadFile.name}`)
        expect(cache.normalizeKey(downloadUrl)).toBe(cache.normalizeKey(runtimeUrl))
    })

    it('getTotalSize returns sum of all required model file sizes', () => {
        const expectedTotal = REQUIRED_TRANSCRIPTION_MODEL_FILES.reduce((sum, f) => sum + f.size, 0)
        expect(TranscriptionModelDownloader.getTotalSize()).toBe(expectedTotal)
        expect(TranscriptionModelDownloader.getTotalSize()).toBeGreaterThan(1.3 * 1024 * 1024 * 1024)
        expect(TranscriptionModelDownloader.getTotalSize()).toBeLessThan(1.5 * 1024 * 1024 * 1024)
    })

    it('getFormattedTotalSize formats total size properly', () => {
        expect(TranscriptionModelDownloader.getFormattedTotalSize(1)).toBe('1.4 GB')
        expect(TranscriptionModelDownloader.getFormattedTotalSize(2)).toBe('1.37 GB')
    })
})
