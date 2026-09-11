/* eslint-disable unicorn/require-post-message-target-origin */
export interface WorkerInitMessage {
    type: 'init'
    modelId: string
    [key: string]: unknown
}

export interface WorkerDownloadProgressMessage {
    type: 'download_progress'
    loaded: number
    total: number
    file?: string
}

export interface WorkerErrorMessage {
    type: 'error'
    message: string
    code?: string
}

export interface WorkerReadyMessage {
    type: 'ready'
}

export type CommonWorkerOutMessage =
    | WorkerReadyMessage
    | WorkerDownloadProgressMessage
    | WorkerErrorMessage
    | { type: string; [key: string]: unknown }

export interface InitializeWorkerOptions<TIn extends WorkerInitMessage> {
    readonly worker: Worker
    readonly initMessage: TIn
    readonly onDownloadProgress?: (loaded: number, total: number, file?: string) => void
    readonly errorPrefix?: string
}

/**
 * Sends an init message to a web worker and awaits its ready message,
 * streaming download progress events along the way.
 */
export async function initializeWorker<TIn extends WorkerInitMessage>(
    options: InitializeWorkerOptions<TIn>,
): Promise<void> {
    const { worker, initMessage, onDownloadProgress, errorPrefix = 'Worker' } = options

    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            worker.removeEventListener('message', handleInit)
            worker.removeEventListener('error', handleError)
        }

        const handleInit = (e: MessageEvent<CommonWorkerOutMessage>) => {
            const data = e.data
            if (data.type === 'ready') {
                cleanup()
                resolve()
            } else if (data.type === 'download_progress') {
                const progressData = data as WorkerDownloadProgressMessage
                onDownloadProgress?.(progressData.loaded, progressData.total, progressData.file)
            } else if (data.type === 'error') {
                cleanup()
                const errorData = data as WorkerErrorMessage
                reject(new Error(errorData.message))
            }
        }

        const handleError = (err: any) => {
            cleanup()
            const cause = err instanceof Error ? err : err.error
            const message = err.message || 'initialization failed'
            reject(new Error(`${errorPrefix}: ${message}`, { cause }))
        }

        worker.addEventListener('message', handleInit)
        worker.addEventListener('error', handleError, { once: true })

        worker.postMessage(initMessage)
    })
}

export interface ExecuteWorkerTaskOptions<TIn, TOut> {
    readonly worker: Worker
    readonly signal?: AbortSignal
    readonly message: TIn
    readonly transfer?: Transferable[]
    readonly isResult: (data: unknown) => data is TOut
    readonly isProgress?: (data: unknown) => boolean
    readonly onProgress?: (data: unknown) => void
    readonly errorPrefix?: string
}

/**
 * Sends a task message to a web worker and awaits its result message,
 * streaming progress events and handling errors and abort signals with full listener cleanup.
 */
export async function executeWorkerTask<TIn, TOut>(options: ExecuteWorkerTaskOptions<TIn, TOut>): Promise<TOut> {
    const { worker, signal, message, transfer, isResult, isProgress, onProgress, errorPrefix = 'Worker' } = options

    return new Promise<TOut>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason)
            return
        }

        const cleanup = () => {
            if (signal) {
                signal.removeEventListener('abort', onAbort)
            }
            worker.removeEventListener('message', handleMessage)
            worker.removeEventListener('error', handleError)
        }

        const onAbort = () => {
            cleanup()
            reject(signal?.reason)
        }

        const handleMessage = (e: MessageEvent<unknown>) => {
            const data = e.data
            if (isProgress?.(data)) {
                onProgress?.(data)
            } else if (isResult(data)) {
                cleanup()
                resolve(data)
            } else if (typeof data === 'object' && data !== null && (data as { type?: string }).type === 'error') {
                cleanup()
                const errorData = data as { message?: string }
                reject(new Error(errorData.message || 'Task failed'))
            }
        }

        const handleError = (err: any) => {
            cleanup()
            const cause = err instanceof Error ? err : err?.error
            const errorMessage = err?.message || 'Execution failed'
            reject(new Error(`${errorPrefix}: ${errorMessage}`, { cause }))
        }

        signal?.addEventListener('abort', onAbort, { once: true })
        worker.addEventListener('message', handleMessage)
        worker.addEventListener('error', handleError, { once: true })

        if (transfer && transfer.length > 0) {
            worker.postMessage(message, transfer)
        } else {
            worker.postMessage(message)
        }
    })
}
