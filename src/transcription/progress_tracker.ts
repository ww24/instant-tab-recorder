import { WHISPER_MODEL_FILES, extractModelRelativePath } from './opfs_cache'
import type { DownloadProgress } from './types'

export interface ModelFileEntry {
    readonly path: string
    readonly size: number
}

export const SILERO_VAD_MODEL_FILES: readonly ModelFileEntry[] = [
    { path: 'config.json', size: 106 },
    { path: 'onnx/model.onnx', size: 2318178 },
] as const

export const SILERO_VAD_TOTAL_BYTES = SILERO_VAD_MODEL_FILES.reduce((acc, f) => acc + f.size, 0)

/**
 * Tracks multi-file model loading progress and computes a smooth, monotonically increasing
 * overall progress percentage (0% - 100%) across all Whisper and Silero VAD model files.
 */
export class ModelLoadProgressTracker {
    private readonly fileSizes = new Map<string, number>()
    private readonly loadedMap = new Map<string, number>()
    private readonly totalBytes: number
    private maxProgress = 0

    constructor(includeVad = true) {
        for (const entry of WHISPER_MODEL_FILES) {
            this.fileSizes.set(`whisper:${entry.path}`, entry.size)
        }
        if (includeVad) {
            for (const entry of SILERO_VAD_MODEL_FILES) {
                this.fileSizes.set(`vad:${entry.path}`, entry.size)
            }
        }
        let total = 0
        for (const s of this.fileSizes.values()) {
            total += s
        }
        this.totalBytes = total
    }

    getTotalBytes(): number {
        return this.totalBytes
    }

    track(modelType: 'whisper' | 'vad', rawProgress: any): DownloadProgress {
        if (!rawProgress || typeof rawProgress !== 'object') {
            return {
                status: 'progress',
                progress: this.maxProgress,
                loaded: this.calculateTotalLoaded(),
                total: this.totalBytes,
            }
        }

        const rawFile = rawProgress.file || ''

        // Normalize relative path
        let relPath = rawFile
        if (modelType === 'whisper') {
            const extracted = extractModelRelativePath(rawFile)
            if (extracted) {
                relPath = extracted
            }
        } else if (modelType === 'vad') {
            if (rawFile.includes('onnx/model.onnx') || rawFile.endsWith('model.onnx')) {
                relPath = 'onnx/model.onnx'
            } else if (rawFile.includes('config.json') || rawFile.endsWith('config.json')) {
                relPath = 'config.json'
            }
        }

        const key = `${modelType}:${relPath}`
        const expectedSize = this.fileSizes.get(key) ?? (rawProgress.total || 0)

        let loaded = 0
        if (typeof rawProgress.loaded === 'number') {
            loaded = rawProgress.loaded
        } else if (typeof rawProgress.progress === 'number' && expectedSize > 0) {
            loaded = Math.round((rawProgress.progress / 100) * expectedSize)
        }

        if (rawProgress.status === 'done' || rawProgress.progress === 100) {
            loaded = Math.max(loaded, expectedSize)
        }

        const prevLoaded = this.loadedMap.get(key) ?? 0
        if (loaded > prevLoaded) {
            this.loadedMap.set(key, loaded)
        }

        const totalLoaded = this.calculateTotalLoaded()
        const calculatedPercent = this.totalBytes > 0 ? Math.min(100, (totalLoaded / this.totalBytes) * 100) : 0

        this.maxProgress = Math.max(this.maxProgress, calculatedPercent)

        const filename = relPath.split('/').pop() || rawFile

        return {
            status: 'progress',
            name: rawProgress.name,
            file: filename || undefined,
            progress: this.maxProgress,
            loaded: totalLoaded,
            total: this.totalBytes,
        }
    }

    markModelComplete(modelType: 'whisper' | 'vad'): DownloadProgress {
        for (const [key, size] of this.fileSizes.entries()) {
            if (key.startsWith(`${modelType}:`)) {
                this.loadedMap.set(key, size)
            }
        }

        const totalLoaded = this.calculateTotalLoaded()
        const calculatedPercent = this.totalBytes > 0 ? Math.min(100, (totalLoaded / this.totalBytes) * 100) : 0

        this.maxProgress = Math.max(this.maxProgress, calculatedPercent)

        return {
            status: 'progress',
            progress: this.maxProgress,
            loaded: totalLoaded,
            total: this.totalBytes,
        }
    }

    private calculateTotalLoaded(): number {
        let total = 0
        for (const bytes of this.loadedMap.values()) {
            total += bytes
        }
        return total
    }
}
