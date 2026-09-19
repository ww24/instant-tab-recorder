import { TaskTracker } from './task_tracker'
import type { Message } from '../message'

/**
 * Wraps a Promise so it rejects with the AbortSignal's reason when the signal
 * fires. The underlying Promise is NOT cancelled (it keeps running), but the
 * caller's await will reject immediately.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
            value => {
                signal.removeEventListener('abort', onAbort)
                resolve(value)
            },
            err => {
                signal.removeEventListener('abort', onAbort)
                reject(err)
            },
        )
    })
}

/** Sentinel error class used to distinguish cancellation from other failures. */
export class CancelledError extends Error {
    constructor(message = 'Task cancelled') {
        super(message)
        this.name = 'CancelledError'
    }
}

export interface BaseMLSessionDeps {
    broadcastMessage(message: Message): Promise<unknown>
    createWorker(): Worker
}

/**
 * Base class managing lifecycle, deduplication, cancellation, and worker cleanup
 * for heavy machine learning background tasks (e.g. Whisper transcription, Gemma summarization).
 */
export abstract class BaseMLSession<TDeps extends BaseMLSessionDeps> {
    private readonly tracker = new TaskTracker<string>()
    private readonly abortControllers = new Map<string, AbortController>()
    private readonly activeWorkers = new Map<string, Worker>()

    constructor(
        protected readonly deps: TDeps,
        protected readonly taskName: string,
    ) {}

    /**
     * Checks if there are any active tasks running in this session.
     */
    hasActiveTasks(): boolean {
        return this.tracker.hasActiveTasks()
    }

    /**
     * Checks if a task is currently running for the given path.
     */
    protected isTaskActive(path: string): boolean {
        return this.tracker.has(path)
    }

    /**
     * Cancels the active task for the given path.
     * Aborts the AbortController and immediately terminates the Worker if created.
     */
    cancel(path: string): void {
        this.abortControllers.get(path)?.abort(new CancelledError(`${this.taskName} cancelled`))
        const worker = this.activeWorkers.get(path)
        if (worker) {
            try {
                worker.terminate()
            } catch (e) {
                console.warn(`Error terminating ${this.taskName.toLowerCase()} worker during cancel:`, e)
            }
        }
    }

    /**
     * Executes an ML task with full lifecycle management:
     * - Deduplication via TaskTracker (warns and returns early if duplicate)
     * - Cancellation tracking via AbortController and activeWorkers map
     * - Graceful cancellation (CancelledError is swallowed without broadcasting error)
     * - Automatic error broadcasting on unexpected failures
     * - Immediate worker termination and resource cleanup in finally
     */
    protected async runTask(
        path: string,
        execute: (signal: AbortSignal, setWorker: (worker: Worker) => void) => Promise<void>,
        options?: {
            errorMessageType?: Message['type']
        },
    ): Promise<void> {
        if (!this.tracker.start(path)) {
            console.warn(`${this.taskName} already in progress for: ${path}`)
            return
        }

        const abortController = new AbortController()
        this.abortControllers.set(path, abortController)
        const { signal } = abortController

        const workerRef: { current: Worker | null } = { current: null }
        const setWorker = (w: Worker) => {
            workerRef.current = w
            this.activeWorkers.set(path, w)
        }

        try {
            await execute(signal, setWorker)
        } catch (e) {
            if (e instanceof CancelledError) {
                console.log(`${this.taskName} cancelled for: ${path}`)
                return
            }
            const errorMsg = e instanceof Error ? e.message : String(e)
            console.error(`${this.taskName} failed for ${path}:`, e)
            if (options?.errorMessageType) {
                await this.deps.broadcastMessage({
                    type: options.errorMessageType,
                    path,
                    error: errorMsg,
                } as any)
            }
            throw e
        } finally {
            this.tracker.finish(path)
            this.abortControllers.delete(path)
            this.activeWorkers.delete(path)
            if (workerRef.current) {
                try {
                    workerRef.current.terminate()
                } catch (termErr) {
                    console.warn(`Error terminating ${this.taskName.toLowerCase()} worker:`, termErr)
                }
            }
        }
    }
}
