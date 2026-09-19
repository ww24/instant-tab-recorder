import { getModelFileUrl, calculateTotalModelSize, formatTotalModelSize, type RequiredModelFile } from './model_files'
import type { ModelCache } from './model_cache'

export interface ModelDownloadProgress {
    loaded: number
    total: number
    file: string
    fileIndex: number
    totalFiles: number
}

export interface ModelDownloaderOptions {
    readonly cache: ModelCache
    readonly errorPrefix?: string
}

/**
 * Downloads model files directly from Hugging Face into model cache without initializing the pipeline.
 */
export class BaseModelDownloader {
    private readonly cache: ModelCache
    private readonly errorPrefix: string
    private isAborted = false
    private isDownloadingFlag = false
    private lastProgress: ModelDownloadProgress | null = null
    private abortController: AbortController | null = null

    constructor(
        protected readonly files: readonly RequiredModelFile[],
        { cache, errorPrefix }: ModelDownloaderOptions,
    ) {
        this.cache = cache
        this.errorPrefix = errorPrefix ?? 'Model download'
    }

    /**
     * Returns the total estimated size of all required model files in bytes.
     */
    getTotalSize(): number {
        return calculateTotalModelSize(this.files)
    }

    /**
     * Returns the formatted total size string (e.g. "1.5 GB").
     */
    getFormattedTotalSize(fractionDigits: number = 1): string {
        return formatTotalModelSize(this.files, fractionDigits)
    }

    get isDownloading(): boolean {
        return this.isDownloadingFlag
    }

    get aborted(): boolean {
        return this.isAborted
    }

    getProgress(): ModelDownloadProgress | null {
        return this.lastProgress
    }

    abort(): void {
        this.isAborted = true
        this.lastProgress = null
        this.abortController?.abort()
    }

    async clearCache(): Promise<void> {
        await this.cache.clear()
    }

    async verifyCache(): Promise<boolean> {
        return this.cache.verifyCache(this.files)
    }

    async download(onProgress?: (progress: ModelDownloadProgress) => void): Promise<void> {
        this.isAborted = false
        this.isDownloadingFlag = true
        this.lastProgress = null
        this.abortController = new AbortController()
        const signal = this.abortController.signal

        const reportProgress = (p: ModelDownloadProgress) => {
            this.lastProgress = p
            onProgress?.(p)
        }

        try {
            const totalFiles = this.files.length
            let totalBytesDownloaded = 0
            const totalSize = this.getTotalSize()

            for (let i = 0; i < totalFiles; i++) {
                if (this.isAborted || signal.aborted) {
                    throw new Error(`${this.errorPrefix} aborted`)
                }

                const file = this.files[i]
                const url = getModelFileUrl(file)

                // Check if already in cache and has exact expected size
                const existing = await this.cache.match(url)
                const existingContentLength = Number(existing?.headers.get('Content-Length') || 0)
                if (existing && existingContentLength === file.size) {
                    totalBytesDownloaded += existingContentLength
                    reportProgress({
                        loaded: totalBytesDownloaded,
                        total: totalSize,
                        file: `${file.repo}/${file.name}`,
                        fileIndex: i + 1,
                        totalFiles,
                    })
                    continue
                }

                let res: Response
                try {
                    console.info(`fetch: ${url}`)
                    res = await fetch(url, { signal })
                } catch (fetchErr) {
                    if (this.isAborted || signal.aborted) {
                        throw new Error(`${this.errorPrefix} aborted`, { cause: fetchErr })
                    }
                    throw fetchErr
                }

                if (!res.ok) {
                    throw new Error(`Failed to download ${file.name}: ${res.status} ${res.statusText}`)
                }

                const contentLength = Number(res.headers.get('Content-Length') || file.size)
                const reader = res.body?.getReader()
                if (!reader) {
                    await this.cache.put(url, res)
                    totalBytesDownloaded += contentLength
                    continue
                }

                const isAborted = () => this.isAborted || signal.aborted
                const errorPrefix = this.errorPrefix
                const stream = new ReadableStream({
                    async start(controller) {
                        try {
                            while (true) {
                                if (isAborted()) {
                                    reader.cancel().catch(() => {})
                                    controller.error(new Error(`${errorPrefix} aborted`))
                                    break
                                }
                                const { done, value } = await reader.read()
                                if (done) {
                                    controller.close()
                                    break
                                }
                                totalBytesDownloaded += value.length
                                reportProgress({
                                    loaded: totalBytesDownloaded,
                                    total: totalSize,
                                    file: `${file.repo}/${file.name}`,
                                    fileIndex: i + 1,
                                    totalFiles,
                                })
                                controller.enqueue(value)
                            }
                        } catch (err) {
                            controller.error(err)
                        }
                    },
                    cancel() {
                        reader.cancel().catch(() => {})
                    },
                })

                const responseToCache = new Response(stream, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: res.headers,
                })

                await this.cache.put(url, responseToCache)
            }

            if (!(await this.verifyCache())) {
                throw new Error(`${this.errorPrefix} completed with missing or incomplete files`)
            }
        } finally {
            this.isDownloadingFlag = false
            this.abortController = null
        }
    }
}
