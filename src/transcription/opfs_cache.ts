/**
 * OPFS (Origin Private File System) model storage and cache backend for Transformers.js.
 * Stores downloaded Whisper models and configurations directly to private disk storage
 * with hierarchical relative paths (no SHA-256 hash overhead) and supports offline
 * local loading (local_files_only: true).
 */

export interface ModelFileEntry {
    readonly path: string
    readonly size: number
}

/**
 * Exact files and byte sizes required by onnx-community/whisper-large-v3-turbo
 * with encoder_model: fp16 and decoder_model_merged: q4.
 */
export const WHISPER_MODEL_FILES: readonly ModelFileEntry[] = [
    { path: 'config.json', size: 1332 },
    { path: 'generation_config.json', size: 3897 },
    { path: 'preprocessor_config.json', size: 340 },
    { path: 'tokenizer.json', size: 2480617 },
    { path: 'tokenizer_config.json', size: 282843 },
    { path: 'onnx/encoder_model_fp16.onnx', size: 1274342603 },
    { path: 'onnx/decoder_model_merged_q4.onnx', size: 334147222 },
] as const

export const WHISPER_TOTAL_BYTES = WHISPER_MODEL_FILES.reduce((acc, f) => acc + f.size, 0)

export const WHISPER_HF_BASE_URL = 'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main'

/**
 * Extracts relative file path (e.g. 'config.json' or 'onnx/encoder_model_fp16.onnx')
 * from a request URL or local path without computing any cryptographic hash.
 */
export function extractModelRelativePath(request: string): string | null {
    const clean = request.split('?')[0].split('#')[0]

    // 1. Hugging Face resolve URL:
    // https://huggingface.co/.../resolve/<rev>/<path>
    const hfPrefix = '/resolve/'
    const hfIdx = clean.indexOf(hfPrefix)
    if (hfIdx !== -1) {
        const afterResolve = clean.substring(hfIdx + hfPrefix.length)
        const slashIdx = afterResolve.indexOf('/')
        if (slashIdx !== -1) {
            return afterResolve.substring(slashIdx + 1)
        }
        return afterResolve
    }

    // 2. Relative or local repository paths:
    // e.g. models/onnx-community/whisper-large-v3-turbo/onnx/encoder_model_fp16.onnx
    // e.g. onnx-community/whisper-large-v3-turbo/onnx/encoder_model_fp16.onnx
    // e.g. whisper-large-v3-turbo/config.json
    const prefixes = ['onnx-community/whisper-large-v3-turbo/', 'whisper-large-v3-turbo/']
    for (const prefix of prefixes) {
        const idx = clean.indexOf(prefix)
        if (idx !== -1) {
            return clean.substring(idx + prefix.length)
        }
    }

    // 3. Fallback: match known Whisper files directly
    for (const entry of WHISPER_MODEL_FILES) {
        if (clean === entry.path || clean.endsWith(`/${entry.path}`)) {
            return entry.path
        }
    }

    return null
}

async function writeStreamToFile(
    fileHandle: FileSystemFileHandle,
    readable: ReadableStream<Uint8Array>,
    onChunk?: (chunkLength: number) => void,
): Promise<void> {
    // 1. Prefer createSyncAccessHandle in Web Worker context for direct zero-IPC disk writing
    if (typeof (fileHandle as any).createSyncAccessHandle === 'function') {
        const accessHandle = await (fileHandle as any).createSyncAccessHandle()
        try {
            accessHandle.truncate(0)
            const reader = readable.getReader()
            let written = 0
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                accessHandle.write(value, { at: written })
                written += value.byteLength
                if (onChunk) onChunk(value.byteLength)
            }
            accessHandle.flush()
        } finally {
            accessHandle.close()
        }
    } else if (typeof (fileHandle as any).createWritable === 'function') {
        // 2. Fallback to createWritable in Window / main thread context
        const writable = await (fileHandle as any).createWritable()
        try {
            const reader = readable.getReader()
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                await writable.write(value)
                if (onChunk) onChunk(value.byteLength)
            }
            await writable.close()
        } catch (err) {
            await writable.abort().catch(() => {})
            throw err
        }
    } else {
        throw new Error('FileSystemFileHandle does not support createSyncAccessHandle or createWritable')
    }
}

export class OPFSCache {
    private modelDirName: string
    private modelDirHandle: FileSystemDirectoryHandle | null = null

    constructor(modelDirName = 'whisper-large-v3-turbo') {
        this.modelDirName = modelDirName
    }

    async getStorageRoot(): Promise<FileSystemDirectoryHandle | null> {
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
            return null
        }
        try {
            return await navigator.storage.getDirectory()
        } catch (e) {
            console.warn('[OPFSCache] Failed to get storage root directory handle:', e)
            return null
        }
    }

    async getModelDirectory(create = false): Promise<FileSystemDirectoryHandle | null> {
        if (this.modelDirHandle) return this.modelDirHandle
        const root = await this.getStorageRoot()
        if (!root) return null
        try {
            const modelsRoot = await root.getDirectoryHandle('models', { create })
            this.modelDirHandle = await modelsRoot.getDirectoryHandle(this.modelDirName, { create })
            return this.modelDirHandle
        } catch {
            return null
        }
    }

    async getFileHandle(relativePath: string, create = false): Promise<FileSystemFileHandle | null> {
        const dir = await this.getModelDirectory(create)
        if (!dir) return null

        const segments = relativePath.split('/').filter(Boolean)
        if (segments.length === 0) return null

        let currentDir = dir
        for (let i = 0; i < segments.length - 1; i++) {
            try {
                currentDir = await currentDir.getDirectoryHandle(segments[i], { create })
            } catch {
                return null
            }
        }

        const fileName = segments[segments.length - 1]
        try {
            return await currentDir.getFileHandle(fileName, { create })
        } catch {
            return null
        }
    }

    async deleteFile(relativePath: string): Promise<boolean> {
        const dir = await this.getModelDirectory(false)
        if (!dir) return false

        const segments = relativePath.split('/').filter(Boolean)
        if (segments.length === 0) return false

        let currentDir = dir
        for (let i = 0; i < segments.length - 1; i++) {
            try {
                currentDir = await currentDir.getDirectoryHandle(segments[i], { create: false })
            } catch {
                return false
            }
        }

        const fileName = segments[segments.length - 1]
        try {
            await currentDir.removeEntry(fileName)
            return true
        } catch {
            return false
        }
    }

    /**
     * Checks if the resource is in OPFS and returns a Response object if found.
     * Operates in O(1) without computing SHA-256 hash.
     */
    async match(request: string): Promise<Response | undefined> {
        const relPath = extractModelRelativePath(request)
        if (!relPath) return undefined

        const fileHandle = await this.getFileHandle(relPath, false)
        if (!fileHandle) return undefined

        try {
            const file = await fileHandle.getFile()
            if (file.size === 0) {
                return undefined
            }

            return new Response(file, {
                status: 200,
                statusText: 'OK',
                headers: {
                    'content-length': String(file.size),
                    'content-type': relPath.endsWith('.json') ? 'application/json' : 'application/octet-stream',
                },
            })
        } catch (err) {
            console.warn('[OPFSCache] match error for', relPath, err)
            return undefined
        }
    }

    /**
     * Saves a response into OPFS with progress tracking.
     */
    async put(
        request: string,
        response: Response,
        progress_callback?: (data: { progress: number; loaded: number; total: number }) => void,
    ): Promise<void> {
        const relPath = extractModelRelativePath(request)
        if (!relPath) return

        const fileHandle = await this.getFileHandle(relPath, true)
        if (!fileHandle) return

        const contentLength = Number(response.headers?.get('content-length')) || 0
        let loaded = 0

        try {
            if (response.body) {
                await writeStreamToFile(fileHandle, response.body, chunkLength => {
                    loaded += chunkLength
                    if (progress_callback) {
                        progress_callback({
                            progress: contentLength > 0 ? (loaded / contentLength) * 100 : 0,
                            loaded,
                            total: contentLength,
                        })
                    }
                })
            } else {
                const buf = await response.arrayBuffer()
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new Uint8Array(buf))
                        controller.close()
                    },
                })
                await writeStreamToFile(fileHandle, stream)
                loaded = buf.byteLength
            }

            if (progress_callback && (contentLength === 0 || loaded >= contentLength)) {
                progress_callback({ progress: 100, loaded, total: loaded })
            }
        } catch (err) {
            console.warn('[OPFSCache] put error for', relPath, err)
            await this.deleteFile(relPath).catch(() => {})
        }
    }

    /**
     * Deletes a cached file from OPFS.
     */
    async delete(request: string): Promise<boolean> {
        const relPath = extractModelRelativePath(request)
        if (!relPath) return false
        return await this.deleteFile(relPath)
    }

    /**
     * Clears all cached files in the model storage directory,
     * including legacy 'transformers-cache' directory if present.
     */
    async clear(): Promise<void> {
        const root = await this.getStorageRoot()
        if (!root) return
        this.modelDirHandle = null
        try {
            const modelsDir = await root.getDirectoryHandle('models', { create: false }).catch(() => null)
            if (modelsDir) {
                await (modelsDir as any).removeEntry(this.modelDirName, { recursive: true }).catch(() => {})
            }
            // Also cleanup legacy 'transformers-cache'
            await (root as any).removeEntry('transformers-cache', { recursive: true }).catch(() => {})
        } catch (e) {
            console.warn('[OPFSCache] clear error:', e)
        }
    }

    /**
     * Calculates total cached bytes for Whisper model files.
     */
    async getTotalSize(): Promise<number> {
        let total = 0
        for (const entry of WHISPER_MODEL_FILES) {
            const handle = await this.getFileHandle(entry.path, false)
            if (!handle) continue
            try {
                const file = await handle.getFile()
                total += file.size
            } catch {
                // Ignore missing or inaccessible file
            }
        }
        return total
    }

    /**
     * Checks if all required Whisper ONNX model files are present and valid.
     */
    async hasModel(): Promise<boolean> {
        for (const entry of WHISPER_MODEL_FILES) {
            const handle = await this.getFileHandle(entry.path, false)
            if (!handle) return false
            try {
                const file = await handle.getFile()
                if (file.size === 0) return false
            } catch {
                return false
            }
        }
        return true
    }
}

/**
 * Downloads all required Whisper model files directly to OPFS storage
 * with accurate overall progress calculation (0% - 100%).
 */
export async function downloadWhisperModel(
    onProgress?: (data: { progress: number; loaded: number; total: number }) => void,
    cache = new OPFSCache(),
): Promise<void> {
    const dir = await cache.getModelDirectory(true)
    if (!dir) {
        throw new Error('OPFS storage directory handle is not available.')
    }

    const totalBytes = WHISPER_TOTAL_BYTES
    let loadedBytes = 0

    // Check which files already exist with complete sizes
    const fileStatus: { entry: ModelFileEntry; exists: boolean }[] = []
    for (const entry of WHISPER_MODEL_FILES) {
        const handle = await cache.getFileHandle(entry.path, false)
        if (handle) {
            try {
                const f = await handle.getFile()
                if (f.size === entry.size) {
                    fileStatus.push({ entry, exists: true })
                    loadedBytes += entry.size
                    continue
                }
            } catch {
                // Not complete
            }
        }
        fileStatus.push({ entry, exists: false })
    }

    if (onProgress) {
        onProgress({
            progress: totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : 0,
            loaded: loadedBytes,
            total: totalBytes,
        })
    }

    for (const item of fileStatus) {
        if (item.exists) continue

        const url = `${WHISPER_HF_BASE_URL}/${item.entry.path}`
        const res = await fetch(url)
        if (!res.ok || !res.body) {
            throw new Error(`Failed to download ${item.entry.path}: HTTP ${res.status} ${res.statusText}`)
        }

        const handle = await cache.getFileHandle(item.entry.path, true)
        if (!handle) {
            throw new Error(`Failed to create OPFS file handle for ${item.entry.path}`)
        }

        try {
            await writeStreamToFile(handle, res.body, chunkLength => {
                loadedBytes += chunkLength
                if (onProgress) {
                    onProgress({
                        status: 'progress',
                        file: item.entry.path,
                        progress: totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0,
                        loaded: loadedBytes,
                        total: totalBytes,
                    })
                }
            })
        } catch (err) {
            await cache.deleteFile(item.entry.path).catch(() => {})
            throw err
        }
    }

    if (onProgress) {
        onProgress({ progress: 100, loaded: totalBytes, total: totalBytes })
    }
}
