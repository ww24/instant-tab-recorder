import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SummarySession, type SummarySessionDeps } from '../src/summary/session'
import { SUMMARY_MODEL_REPO } from '../src/summary/model_files'
import type { TranscriptionResult } from '../src/transcription/types'

class MockWorker {
    listeners: Record<string, ((e: any) => void)[]> = {}
    postedMessages: any[] = []
    terminated = false

    postMessage = vi.fn((msg: any) => {
        this.postedMessages.push(msg)
    })

    addEventListener = vi.fn((event: string, fn: any) => {
        if (!this.listeners[event]) this.listeners[event] = []
        this.listeners[event].push(fn)
    })

    removeEventListener = vi.fn((event: string, fn: any) => {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(f => f !== fn)
        }
    })

    terminate = vi.fn(() => {
        this.terminated = true
    })

    emitMessage(data: any) {
        const listeners = [...(this.listeners['message'] || [])]
        for (const fn of listeners) {
            fn({ data })
        }
    }

    emitError(error: any) {
        const listeners = [...(this.listeners['error'] || [])]
        for (const fn of listeners) {
            fn(error)
        }
    }
}

describe('SummarySession', () => {
    let mockWorker: MockWorker
    let deps: SummarySessionDeps
    const sampleTranscription: TranscriptionResult = {
        segments: [
            { startSec: 0, endSec: 2, text: 'First segment.' },
            { startSec: 2, endSec: 4, text: 'Second segment.' },
        ],
        language: 'english',
        transcribedAt: 1234567890,
        modelId: 'whisper-test',
    }

    beforeEach(() => {
        mockWorker = new MockWorker()
        deps = {
            getTranscription: vi.fn().mockResolvedValue(sampleTranscription),
            saveSummary: vi.fn().mockResolvedValue(undefined),
            broadcastMessage: vi.fn().mockResolvedValue(undefined),
            createWorker: vi.fn().mockReturnValue(mockWorker as unknown as Worker),
            getPrompt: vi.fn().mockReturnValue(undefined),
        }
    })

    it('successfully summarizes transcription, saves result, and terminates worker', async () => {
        const session = new SummarySession(deps)
        expect(session.isSummarizing('rec.webm')).toBe(false)
        expect(session.hasActiveTasks()).toBe(false)

        const promise = session.summarize('rec.webm')
        expect(session.isSummarizing('rec.webm')).toBe(true)
        expect(session.hasActiveTasks()).toBe(true)

        // Wait for worker creation and init message
        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith({
                type: 'init',
                modelId: SUMMARY_MODEL_REPO,
            })
        })

        // Worker emits download progress then ready
        mockWorker.emitMessage({
            type: 'download_progress',
            loaded: 50,
            total: 100,
        })
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-progress',
            path: 'rec.webm',
            stage: 'model_load',
            loaded: 50,
            total: 100,
        })

        mockWorker.emitMessage({ type: 'ready' })

        // Worker receives summarize message
        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith({
                type: 'summarize',
                text: 'First segment.\nSecond segment.',
                prompt: undefined,
            })
        })

        // Worker emits generation progress
        mockWorker.emitMessage({
            type: 'summary_progress',
            stage: 'generating',
            progress: 0.75,
        })
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-progress',
            path: 'rec.webm',
            stage: 'generating',
            loaded: 75,
            total: 100,
        })

        // Worker emits result
        mockWorker.emitMessage({
            type: 'result',
            summaryText: 'Executive summary text.',
            timings: { modelLoadMs: 10, inferenceMs: 200 },
        })

        await promise

        expect(session.isSummarizing('rec.webm')).toBe(false)
        expect(session.hasActiveTasks()).toBe(false)

        expect(deps.saveSummary).toHaveBeenCalledWith('rec.webm', {
            text: 'Executive summary text.',
            summarizedAt: expect.any(Number),
            modelId: SUMMARY_MODEL_REPO,
        })

        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-complete',
            path: 'rec.webm',
            summary: {
                text: 'Executive summary text.',
                summarizedAt: expect.any(Number),
                modelId: SUMMARY_MODEL_REPO,
            },
        })

        expect(mockWorker.terminate).toHaveBeenCalled()
    })

    it('passes custom prompt when getPrompt is configured', async () => {
        deps.getPrompt = vi.fn().mockReturnValue('Summarize in bullet points.')
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith({
                type: 'init',
                modelId: SUMMARY_MODEL_REPO,
            })
        })

        mockWorker.emitMessage({ type: 'ready' })

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith({
                type: 'summarize',
                text: 'First segment.\nSecond segment.',
                prompt: 'Summarize in bullet points.',
            })
        })

        mockWorker.emitMessage({
            type: 'result',
            summaryText: '- Point 1\n- Point 2',
            timings: { modelLoadMs: 0, inferenceMs: 100 },
        })

        await promise
        expect(mockWorker.terminate).toHaveBeenCalled()
    })

    it('suppresses duplicate tasks for the same path', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const session = new SummarySession(deps)

        const firstPromise = session.summarize('rec.webm')
        expect(session.isSummarizing('rec.webm')).toBe(true)

        // Attempt second summarize while first is still running
        await session.summarize('rec.webm')
        expect(warnSpy).toHaveBeenCalledWith('Summary already in progress for: rec.webm')

        // Complete the first task
        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })
        // Worker should have been created exactly once
        expect(deps.createWorker).toHaveBeenCalledTimes(1)
        mockWorker.emitMessage({ type: 'ready' })

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'summarize' }))
        })
        mockWorker.emitMessage({
            type: 'result',
            summaryText: 'Summary',
            timings: { modelLoadMs: 0, inferenceMs: 50 },
        })

        await firstPromise
        expect(session.isSummarizing('rec.webm')).toBe(false)
        warnSpy.mockRestore()
    })

    it('throws error and broadcasts summary-error when transcription is missing or empty', async () => {
        const session = new SummarySession(deps)

        // Null transcription
        deps.getTranscription = vi.fn().mockResolvedValue(null)
        await expect(session.summarize('no-transcription.webm')).rejects.toThrow(
            'No transcription available to summarize',
        )
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'no-transcription.webm',
            error: 'No transcription available to summarize',
        })
        expect(deps.createWorker).not.toHaveBeenCalled()
        expect(session.isSummarizing('no-transcription.webm')).toBe(false)

        // Empty segments
        deps.getTranscription = vi.fn().mockResolvedValue({
            segments: [],
            language: 'en',
            transcribedAt: 1234567890,
            modelId: 'test-model',
        })
        await expect(session.summarize('empty-segments.webm')).rejects.toThrow(
            'No transcription available to summarize',
        )
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'empty-segments.webm',
            error: 'No transcription available to summarize',
        })

        // Whitespace only segments
        deps.getTranscription = vi.fn().mockResolvedValue({
            segments: [{ startSec: 0, endSec: 1, text: '   ' }],
            language: 'en',
            transcribedAt: 1234567890,
            modelId: 'test-model',
        })
        await expect(session.summarize('whitespace.webm')).rejects.toThrow('Transcription text is empty')
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'whitespace.webm',
            error: 'Transcription text is empty',
        })
    })

    it('terminates worker and broadcasts error on worker initialization failure', async () => {
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })

        mockWorker.emitMessage({
            type: 'error',
            message: 'Failed to load WebGPU model weights',
        })

        await expect(promise).rejects.toThrow('Failed to load WebGPU model weights')

        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'rec.webm',
            error: 'Failed to load WebGPU model weights',
        })
        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isSummarizing('rec.webm')).toBe(false)
    })

    it('terminates worker and broadcasts error on worker summarization error', async () => {
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })
        mockWorker.emitMessage({ type: 'ready' })

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'summarize' }))
        })

        mockWorker.emitMessage({
            type: 'error',
            message: 'GPU out of memory during generation',
        })

        await expect(promise).rejects.toThrow('GPU out of memory during generation')

        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'rec.webm',
            error: 'GPU out of memory during generation',
        })
        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isSummarizing('rec.webm')).toBe(false)
    })

    it('terminates worker and broadcasts error on worker error event', async () => {
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })
        mockWorker.emitMessage({ type: 'ready' })

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'summarize' }))
        })

        const originalError = new Error('Worker process crashed unexpectedly')
        mockWorker.emitError({ message: 'Worker process crashed unexpectedly', error: originalError })

        let caughtError: Error | null = null
        try {
            await promise
        } catch (err: any) {
            caughtError = err
        }

        expect(caughtError).toBeInstanceOf(Error)
        expect(caughtError?.message).toBe('Summary worker: Worker process crashed unexpectedly')
        expect((caughtError as any)?.cause).toBe(originalError)

        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'rec.webm',
            error: 'Summary worker: Worker process crashed unexpectedly',
        })
        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isSummarizing('rec.webm')).toBe(false)
    })

    it('terminates worker and broadcasts error when saveSummary fails', async () => {
        deps.saveSummary = vi.fn().mockRejectedValue(new Error('IndexedDB quota exceeded'))
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })
        mockWorker.emitMessage({ type: 'ready' })

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'summarize' }))
        })
        mockWorker.emitMessage({
            type: 'result',
            summaryText: 'Done',
            timings: { modelLoadMs: 0, inferenceMs: 50 },
        })

        await expect(promise).rejects.toThrow('IndexedDB quota exceeded')

        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'summary-error',
            path: 'rec.webm',
            error: 'IndexedDB quota exceeded',
        })
        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isSummarizing('rec.webm')).toBe(false)
    })

    it('terminates worker and handles error when broadcastMessage on completion fails', async () => {
        deps.broadcastMessage = vi.fn().mockImplementation((msg: any) => {
            if (msg.type === 'summary-complete') {
                return Promise.reject(new Error('Broadcast failed'))
            }
            return Promise.resolve()
        })
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })
        mockWorker.emitMessage({ type: 'ready' })

        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'summarize' }))
        })
        mockWorker.emitMessage({
            type: 'result',
            summaryText: 'Done',
            timings: { modelLoadMs: 0, inferenceMs: 50 },
        })

        await expect(promise).rejects.toThrow('Broadcast failed')
        expect(mockWorker.terminate).toHaveBeenCalled()
        expect(session.isSummarizing('rec.webm')).toBe(false)
    })

    it('cancel() settles summarize() immediately via AbortController and terminates the worker', async () => {
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')
        expect(session.isSummarizing('rec.webm')).toBe(true)

        // Wait for worker to be created (init message sent)
        await vi.waitFor(() => {
            expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }))
        })

        // Cancel — the AbortController rejects the promise without needing a Worker error event
        session.cancel('rec.webm')
        expect(mockWorker.terminate).toHaveBeenCalled()

        // summarize() resolves (CancelledError is caught and swallowed internally)
        await expect(promise).resolves.toBeUndefined()
        expect(session.isSummarizing('rec.webm')).toBe(false)
        // No summary-error should be broadcast on cancellation
        expect(deps.broadcastMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'summary-error' }))
    })

    it('cancel() before worker is created still settles summarize()', async () => {
        // Make getTranscription hang until we cancel
        let resolveTranscription!: (v: typeof sampleTranscription) => void
        deps.getTranscription = vi.fn(
            () =>
                new Promise<typeof sampleTranscription>(res => {
                    resolveTranscription = res
                }),
        )
        const session = new SummarySession(deps)

        const promise = session.summarize('rec.webm')
        expect(session.isSummarizing('rec.webm')).toBe(true)

        // Cancel before getTranscription resolves (Worker not yet created)
        session.cancel('rec.webm')

        // summarize() resolves cleanly (CancelledError swallowed)
        await expect(promise).resolves.toBeUndefined()
        expect(session.isSummarizing('rec.webm')).toBe(false)
        // Worker was never created
        expect(deps.createWorker).not.toHaveBeenCalled()
        expect(mockWorker.terminate).not.toHaveBeenCalled()

        // Unblock the hanging promise (no-op after cancellation)
        resolveTranscription(sampleTranscription)
    })

    it('cancel() is a no-op when no task is active for the given path', () => {
        const session = new SummarySession(deps)
        // Should not throw
        expect(() => session.cancel('nonexistent.webm')).not.toThrow()
        expect(mockWorker.terminate).not.toHaveBeenCalled()
    })
})
