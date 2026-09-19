import { describe, it, expect } from 'vitest'
import { resolveWasmUrl, mapWebGPUError } from '../src/ml/worker_env'

describe('worker_env', () => {
    describe('resolveWasmUrl', () => {
        it('keeps absolute http/https/chrome-extension URLs as is', () => {
            expect(resolveWasmUrl('https://example.com/file.wasm')).toBe('https://example.com/file.wasm')
            expect(resolveWasmUrl('http://example.com/file.wasm')).toBe('http://example.com/file.wasm')
            expect(resolveWasmUrl('chrome-extension://abcdef/file.wasm')).toBe('chrome-extension://abcdef/file.wasm')
        })

        it('prefixes relative path with dist/ if not present', () => {
            const url = resolveWasmUrl('assets/ort.wasm')
            expect(url).toContain('dist/assets/ort.wasm')
        })
    })

    describe('mapWebGPUError', () => {
        it('maps FP16 and shader errors to WEBGPU_FP16_NOT_SUPPORTED', () => {
            const err1 = new Error('shader-f16 is not supported')
            expect(mapWebGPUError(err1).message).toBe('WEBGPU_FP16_NOT_SUPPORTED')

            const err2 = new Error('FP16 feature not enabled')
            expect(mapWebGPUError(err2).message).toBe('WEBGPU_FP16_NOT_SUPPORTED')

            const err3 = new Error('unsupported device')
            expect(mapWebGPUError(err3).message).toBe('WEBGPU_FP16_NOT_SUPPORTED')
        })

        it('preserves other errors as standard Errors', () => {
            const err = new Error('network failure')
            expect(mapWebGPUError(err).message).toBe('network failure')

            const nonErr = 'string error'
            expect(mapWebGPUError(nonErr).message).toBe('string error')
        })
    })
})
