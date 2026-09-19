import { getModelFileUrl, type RequiredModelFile } from './model_files'
import type { ModelCache } from './model_cache'

/**
 * OPFS (Origin Private File System) custom cache backend for Transformers.js.
 * Stores downloaded ONNX models and configurations directly to private disk storage
 * so that downloads occur only once and do not cause JavaScript heap memory bloat.
 */
export class OPFSModelCache implements ModelCache {
    private readonly dirName: string
    private readonly requiredFiles: readonly RequiredModelFile[]
    private dirHandle: FileSystemDirectoryHandle | null = null

    constructor(dirName: string, requiredFiles: readonly RequiredModelFile[]) {
        this.dirName = dirName
        this.requiredFiles = requiredFiles
    }

    private async getDirectory(): Promise<FileSystemDirectoryHandle | null> {
        if (this.dirHandle) return this.dirHandle
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
            return null
        }
        try {
            const root = await navigator.storage.getDirectory()
            this.dirHandle = await root.getDirectoryHandle(this.dirName, { create: true })
            return this.dirHandle
        } catch (e) {
            console.warn('[OPFSModelCache] Failed to get OPFS directory handle:', e)
            return null
        }
    }

    /**
     * Normalizes a request key (URL or repo path).
     */
    normalizeKey(key: string): string {
        return key
            .replace(/^https?:\/\/[^/]+\//, '')
            .replace(/\/resolve\/[^/]+\//, '/')
            .replace(/^\/+/, '')
    }

    /**
     * Generates a collision-resistant, valid filesystem file name.
     */
    async getCacheFileName(rawKey: string): Promise<string> {
        const normalized = this.normalizeKey(rawKey)
        const encoder = new TextEncoder()
        const data = encoder.encode(normalized)

        let hashHex = ''
        if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
            const digest = await crypto.subtle.digest('SHA-256', data)
            const hashArray = Array.from(new Uint8Array(digest))
            hashHex = hashArray
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')
                .slice(0, 32)
        } else {
            let h = 0
            for (let i = 0; i < normalized.length; i++) {
                h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0
            }
            hashHex = Math.abs(h).toString(16).padStart(8, '0')
        }

        const baseName = (normalized.split('/').pop() || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-64)

        return `${hashHex}_${baseName}`
    }

    /**
     * Checks if the resource is in OPFS and returns a Response object if found.
     */
    async match(request: Request | string): Promise<Response | undefined> {
        const key = typeof request === 'string' ? request : request.url
        const dir = await this.getDirectory()
        if (!dir) return undefined

        try {
            const fileName = await this.getCacheFileName(key)
            const fileHandle = await dir.getFileHandle(fileName)
            const file = await fileHandle.getFile()

            if (file.size === 0) return undefined

            return new Response(file, {
                status: 200,
                headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                    'Content-Length': file.size.toString(),
                },
            })
        } catch {
            return undefined
        }
    }

    /**
     * Streams a response body directly to a file in OPFS.
     */
    async put(request: Request | string, response: Response): Promise<void> {
        const key = typeof request === 'string' ? request : request.url
        const dir = await this.getDirectory()
        if (!dir) return

        const fileName = await this.getCacheFileName(key)
        const fileHandle = await dir.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()

        if (response.body) {
            await response.body.pipeTo(writable)
        } else {
            const buffer = await response.arrayBuffer()
            await writable.write(buffer)
            await writable.close()
        }
    }

    /**
     * Deletes a cached resource.
     */
    async delete(request: Request | string): Promise<boolean> {
        const key = typeof request === 'string' ? request : request.url
        const dir = await this.getDirectory()
        if (!dir) return false

        try {
            const fileName = await this.getCacheFileName(key)
            await dir.removeEntry(fileName)
            return true
        } catch {
            return false
        }
    }

    /**
     * Clears all cached model files.
     */
    async clear(): Promise<void> {
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return
        try {
            const root = await navigator.storage.getDirectory()
            const dir = await root.getDirectoryHandle(this.dirName)
            for await (const [name] of dir.entries()) {
                await dir.removeEntry(name, { recursive: true })
            }
        } catch (e) {
            console.warn('[OPFSModelCache] Failed to clear cache directory:', e)
        }
    }

    /**
     * Checks if all required model artifacts exist in the cache with their expected sizes.
     */
    async hasCache(requiredFiles: readonly RequiredModelFile[] = this.requiredFiles): Promise<boolean> {
        if (requiredFiles.length === 0) return false
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return false
        try {
            const root = await navigator.storage.getDirectory()
            const dir = await root.getDirectoryHandle(this.dirName)

            for (const file of requiredFiles) {
                const url = getModelFileUrl(file)
                const fileName = await this.getCacheFileName(url)
                try {
                    const fileHandle = await dir.getFileHandle(fileName)
                    const fileData = await fileHandle.getFile()
                    if (fileData.size !== file.size) {
                        console.warn(
                            `invalid file size: ${file.repo}/${file.name}, expected: ${file.size}, actual: ${fileData.size}`,
                        )
                        return false
                    }
                } catch {
                    return false
                }
            }
            return true
        } catch {
            return false
        }
    }

    /**
     * Calculates the SHA-256 hash of a file as a lowercase hex string.
     */
    async calculateFileHash(file: File): Promise<string> {
        const buffer = await file.arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', buffer)
        const hashArray = Array.from(new Uint8Array(digest))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }

    /**
     * Checks if all required model artifacts exist in the cache with their expected SHA-256 hashes.
     */
    async verifyCache(requiredFiles: readonly RequiredModelFile[] = this.requiredFiles): Promise<boolean> {
        if (requiredFiles.length === 0) return false
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return false
        if (typeof crypto === 'undefined' || !crypto.subtle?.digest) return false
        try {
            const root = await navigator.storage.getDirectory()
            const dir = await root.getDirectoryHandle(this.dirName)

            for (const file of requiredFiles) {
                const url = getModelFileUrl(file)
                const fileName = await this.getCacheFileName(url)
                try {
                    const fileHandle = await dir.getFileHandle(fileName)
                    const fileData = await fileHandle.getFile()
                    const hash = await this.calculateFileHash(fileData)
                    if (hash !== file.sha256) {
                        console.warn(
                            `invalid sha256 hash: ${file.repo}/${file.name}, expected: ${file.sha256}, actual: ${hash}`,
                        )
                        return false
                    }
                } catch {
                    return false
                }
            }
            return true
        } catch {
            return false
        }
    }
}
