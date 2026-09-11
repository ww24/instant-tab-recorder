import { describe, test, expect, vi, afterEach } from 'vitest'
import { checkWebGPUSupport } from '../src/transcription/webgpu'

describe('checkWebGPUSupport', () => {
    const originalNavigator = globalThis.navigator

    afterEach(() => {
        vi.restoreAllMocks()
        // Restore navigator
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            writable: true,
            configurable: true,
        })
    })

    test('returns no-webgpu if navigator has no gpu property', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {},
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: false, reason: 'no-webgpu' })
    })

    test('returns no-webgpu if requestAdapter is not a function', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: false, reason: 'no-webgpu' })
    })

    test('returns no-webgpu if requestAdapter returns null', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: {
                    requestAdapter: vi.fn().mockResolvedValue(null),
                },
            },
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: false, reason: 'no-webgpu' })
    })

    test('returns no-webgpu if requestAdapter throws an error', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: {
                    requestAdapter: vi.fn().mockRejectedValue(new Error('GPU context lost')),
                },
            },
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: false, reason: 'no-webgpu' })
    })

    test('returns no-shader-f16 if features does not have shader-f16', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: {
                    requestAdapter: vi.fn().mockResolvedValue({
                        features: {
                            has: vi.fn((feature: string) => feature !== 'shader-f16'),
                        },
                    }),
                },
            },
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: false, reason: 'no-shader-f16' })
    })

    test('returns no-shader-f16 if features property is missing', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: {
                    requestAdapter: vi.fn().mockResolvedValue({}),
                },
            },
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: false, reason: 'no-shader-f16' })
    })

    test('returns supported: true if WebGPU and shader-f16 are supported', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: {
                    requestAdapter: vi.fn().mockResolvedValue({
                        features: {
                            has: vi.fn((feature: string) => feature === 'shader-f16'),
                        },
                    }),
                },
            },
            writable: true,
            configurable: true,
        })

        const result = await checkWebGPUSupport()
        expect(result).toEqual({ supported: true })
    })
})
