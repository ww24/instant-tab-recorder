import { describe, it, expect, vi } from 'vitest'
import { initializeWorker } from '../src/ml/worker_client'

describe('initializeWorker', () => {
    it('resolves when worker posts ready message', async () => {
        const listeners: Record<string, ((e: any) => void)[]> = {}
        const mockWorker = {
            postMessage: vi.fn(),
            addEventListener: vi.fn((event: string, fn: any) => {
                if (!listeners[event]) listeners[event] = []
                listeners[event].push(fn)
            }),
            removeEventListener: vi.fn((event: string, fn: any) => {
                if (listeners[event]) {
                    listeners[event] = listeners[event].filter(f => f !== fn)
                }
            }),
        } as unknown as Worker

        const promise = initializeWorker({
            worker: mockWorker,
            initMessage: { type: 'init', modelId: 'test-model' },
        })

        // Simulate ready message
        listeners['message']?.forEach(fn => fn({ data: { type: 'ready' } }))

        await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with Error wrapping prefix, message, and cause on worker error event', async () => {
        const listeners: Record<string, ((e: any) => void)[]> = {}
        const mockWorker = {
            postMessage: vi.fn(),
            addEventListener: vi.fn((event: string, fn: any) => {
                if (!listeners[event]) listeners[event] = []
                listeners[event].push(fn)
            }),
            removeEventListener: vi.fn((event: string, fn: any) => {
                if (listeners[event]) {
                    listeners[event] = listeners[event].filter(f => f !== fn)
                }
            }),
        } as unknown as Worker

        const promise = initializeWorker({
            worker: mockWorker,
            initMessage: { type: 'init', modelId: 'test-model' },
            errorPrefix: 'CustomWorker',
        })

        const originalError = new Error('Script execution failed')
        // Simulate ErrorEvent
        listeners['error']?.forEach(fn =>
            fn({
                message: 'Script execution failed',
                error: originalError,
            }),
        )

        let caughtError: Error | null = null
        try {
            await promise
        } catch (err: any) {
            caughtError = err
        }

        expect(caughtError).toBeInstanceOf(Error)
        expect(caughtError?.message).toBe('CustomWorker: Script execution failed')
        expect((caughtError as any)?.cause).toBe(originalError)
    })

    it('falls back to default message if err.message is empty', async () => {
        const listeners: Record<string, ((e: any) => void)[]> = {}
        const mockWorker = {
            postMessage: vi.fn(),
            addEventListener: vi.fn((event: string, fn: any) => {
                if (!listeners[event]) listeners[event] = []
                listeners[event].push(fn)
            }),
            removeEventListener: vi.fn((event: string, fn: any) => {
                if (listeners[event]) {
                    listeners[event] = listeners[event].filter(f => f !== fn)
                }
            }),
        } as unknown as Worker

        const promise = initializeWorker({
            worker: mockWorker,
            initMessage: { type: 'init', modelId: 'test-model' },
            errorPrefix: 'TestWorker',
        })

        listeners['error']?.forEach(fn => fn({}))

        let caughtError: Error | null = null
        try {
            await promise
        } catch (err: any) {
            caughtError = err
        }

        expect(caughtError).toBeInstanceOf(Error)
        expect(caughtError?.message).toBe('TestWorker: initialization failed')
    })
})
