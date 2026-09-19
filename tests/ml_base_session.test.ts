import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseMLSession, abortable, type BaseMLSessionDeps } from '../src/ml/base_session'
import type { Message } from '../src/message'

describe('abortable', () => {
    it('resolves if the underlying promise resolves before abort', async () => {
        const controller = new AbortController()
        const promise = Promise.resolve('ok')
        const result = await abortable(promise, controller.signal)
        expect(result).toBe('ok')
    })

    it('rejects if the underlying promise rejects before abort', async () => {
        const controller = new AbortController()
        const promise = Promise.reject(new Error('fail'))
        await expect(abortable(promise, controller.signal)).rejects.toThrow('fail')
    })

    it('rejects immediately if signal is already aborted', async () => {
        const controller = new AbortController()
        const customReason = new Error('already aborted')
        controller.abort(customReason)

        const promise = new Promise(resolve => setTimeout(() => resolve('late'), 50))
        await expect(abortable(promise, controller.signal)).rejects.toThrow('already aborted')
    })

    it('rejects immediately when signal aborts while promise is pending', async () => {
        const controller = new AbortController()
        const promise = new Promise(resolve => setTimeout(() => resolve('late'), 100))

        const abortablePromise = abortable(promise, controller.signal)
        const abortReason = new Error('aborted in flight')
        controller.abort(abortReason)

        await expect(abortablePromise).rejects.toThrow('aborted in flight')
    })
})

class TestSession extends BaseMLSession<BaseMLSessionDeps> {
    constructor(deps: BaseMLSessionDeps) {
        super(deps, 'TestTask')
    }

    isActive(path: string): boolean {
        return this.isTaskActive(path)
    }

    async run(
        path: string,
        fn: (signal: AbortSignal, setWorker: (w: Worker) => void) => Promise<void>,
        options?: { errorMessageType?: Message['type'] },
    ): Promise<void> {
        return this.runTask(path, fn, options)
    }
}

describe('BaseMLSession', () => {
    let mockWorker: {
        postMessage: ReturnType<typeof vi.fn>
        addEventListener: ReturnType<typeof vi.fn>
        removeEventListener: ReturnType<typeof vi.fn>
        terminate: ReturnType<typeof vi.fn>
    }
    let deps: BaseMLSessionDeps

    beforeEach(() => {
        mockWorker = {
            postMessage: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            terminate: vi.fn(),
        }
        deps = {
            createWorker: vi.fn().mockReturnValue(mockWorker as unknown as Worker),
            broadcastMessage: vi.fn().mockResolvedValue(undefined),
        }
    })

    it('runs task and cleans up worker and tracking on completion', async () => {
        const session = new TestSession(deps)
        expect(session.hasActiveTasks()).toBe(false)
        expect(session.isActive('test.webm')).toBe(false)

        let wasActiveInside = false
        const promise = session.run('test.webm', async (_signal, setWorker) => {
            const worker = deps.createWorker()
            setWorker(worker)
            wasActiveInside = session.isActive('test.webm')
        })

        await promise

        expect(wasActiveInside).toBe(true)
        expect(session.hasActiveTasks()).toBe(false)
        expect(session.isActive('test.webm')).toBe(false)
        expect(mockWorker.terminate).toHaveBeenCalledTimes(1)
    })

    it('suppresses duplicate execution for the same path', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const session = new TestSession(deps)

        let finishFirstTask!: () => void
        const firstPromise = session.run('test.webm', () => {
            return new Promise<void>(res => {
                finishFirstTask = res
            })
        })

        // Attempt second execution while first is in progress
        await session.run('test.webm', async () => {})

        expect(warnSpy).toHaveBeenCalledWith('TestTask already in progress for: test.webm')

        finishFirstTask()
        await firstPromise

        warnSpy.mockRestore()
    })

    it('cancels task and terminates worker without broadcasting error', async () => {
        const session = new TestSession(deps)

        let taskSignal!: AbortSignal
        const promise = session.run(
            'test.webm',
            async (signal, setWorker) => {
                taskSignal = signal
                setWorker(deps.createWorker())
                return new Promise<void>((_, reject) => {
                    signal.addEventListener('abort', () => reject(signal.reason))
                })
            },
            { errorMessageType: 'transcription-error' },
        )

        expect(session.isActive('test.webm')).toBe(true)

        session.cancel('test.webm')

        await promise

        expect(taskSignal.aborted).toBe(true)
        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isActive('test.webm')).toBe(false)
        expect(deps.broadcastMessage).not.toHaveBeenCalled()
    })

    it('broadcasts error and terminates worker on unexpected failure', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const session = new TestSession(deps)

        const promise = session.run(
            'test.webm',
            async (_signal, setWorker) => {
                setWorker(deps.createWorker())
                throw new Error('Something went wrong')
            },
            { errorMessageType: 'transcription-error' },
        )

        await expect(promise).rejects.toThrow('Something went wrong')

        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isActive('test.webm')).toBe(false)
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'transcription-error',
            path: 'test.webm',
            error: 'Something went wrong',
        })

        errorSpy.mockRestore()
    })

    it('cancel is a no-op when path is not active', () => {
        const session = new TestSession(deps)
        expect(() => session.cancel('nonexistent.webm')).not.toThrow()
        expect(mockWorker.terminate).not.toHaveBeenCalled()
    })
})
