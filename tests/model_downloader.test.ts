import { describe, it, expect } from 'vitest'
import { ModelDownloader } from '../src/transcription/model_downloader'
import {
    REQUIRED_MODEL_FILES,
    getModelFileUrl,
    VAD_MODEL_REPO,
    WHISPER_MODEL_REPO,
} from '../src/transcription/model_files'

import { OPFSModelCache } from '../src/transcription/opfs_model_cache'

describe('ModelDownloader', () => {
    it('REQUIRED_MODEL_FILES contains valid files and positive sizes', () => {
        expect(REQUIRED_MODEL_FILES.length).toBeGreaterThan(0)
        for (const file of REQUIRED_MODEL_FILES) {
            expect(file.repo).toBeTruthy()
            expect(file.revision).toBeTruthy()
            expect(file.name).toBeTruthy()
            expect(file.size).toBeGreaterThan(0)
        }
    })

    it('REQUIRED_MODEL_FILES contains both Whisper and Silero VAD model files', () => {
        const whisperFiles = REQUIRED_MODEL_FILES.filter(f => f.repo === WHISPER_MODEL_REPO)
        const vadFiles = REQUIRED_MODEL_FILES.filter(f => f.repo === VAD_MODEL_REPO)

        expect(whisperFiles.length).toBe(7)
        expect(vadFiles.length).toBe(1)
        expect(vadFiles[0].name).toBe('onnx/model.onnx')
    })

    it('getModelFileUrl produces valid HuggingFace resolve URLs', () => {
        const vadFile = REQUIRED_MODEL_FILES.find(f => f.repo === VAD_MODEL_REPO)!
        const url = getModelFileUrl(vadFile)
        expect(url).toBe(`https://huggingface.co/${vadFile.repo}/resolve/${vadFile.revision}/${vadFile.name}`)
    })

    it('download URL and runtime inference URL normalize to identical cache keys', () => {
        const cache = new OPFSModelCache()
        const vadFile = REQUIRED_MODEL_FILES.find(f => f.repo === VAD_MODEL_REPO)!
        const downloadUrl = getModelFileUrl(vadFile)
        const runtimeUrl = `https://huggingface.co/${VAD_MODEL_REPO}/resolve/main/${vadFile.name}`

        expect(cache.normalizeKey(downloadUrl)).toBe(`${VAD_MODEL_REPO}/${vadFile.name}`)
        expect(cache.normalizeKey(downloadUrl)).toBe(cache.normalizeKey(runtimeUrl))
    })

    it('getTotalSize returns sum of all required model file sizes', () => {
        const expectedTotal = REQUIRED_MODEL_FILES.reduce((sum, f) => sum + f.size, 0)
        expect(ModelDownloader.getTotalSize()).toBe(expectedTotal)
        expect(ModelDownloader.getTotalSize()).toBeGreaterThan(1.3 * 1024 * 1024 * 1024)
        expect(ModelDownloader.getTotalSize()).toBeLessThan(1.5 * 1024 * 1024 * 1024)
    })

    it('getFormattedTotalSize formats total size properly', () => {
        expect(ModelDownloader.getFormattedTotalSize(1)).toBe('1.4 GB')
        expect(ModelDownloader.getFormattedTotalSize(2)).toBe('1.37 GB')
    })
})
