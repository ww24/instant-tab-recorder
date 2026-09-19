import { env } from '@huggingface/transformers'
import { OPFSModelCache } from './opfs_model_cache'
import type { RequiredModelFile } from './model_files'

/**
 * Resolves a WASM asset URL appropriately for web worker, extension, or dev bundle context.
 */
export function resolveWasmUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome-extension://')) {
        return url
    }
    let relativePath = url.startsWith('/') ? url.slice(1) : url
    if (!relativePath.startsWith('dist/')) {
        relativePath = `dist/${relativePath}`
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        return chrome.runtime.getURL(relativePath)
    }
    if (typeof self !== 'undefined' && self.location?.origin?.startsWith('chrome-extension://')) {
        return new URL(relativePath, self.location.origin + '/').href
    }
    return new URL(relativePath, import.meta.url).href
}

export interface SetupTransformersEnvOptions {
    readonly cacheDirName: string
    readonly requiredFiles: readonly RequiredModelFile[]
    readonly ortWasmUrl?: string
    readonly numThreads?: number
}

/**
 * Configures Transformers.js and ONNX Runtime environment for offline OPFS operation and WebGPU execution.
 */
export function setupTransformersEnv(options: SetupTransformersEnvOptions): OPFSModelCache {
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.useWasmCache = false

    const opfsCache = new OPFSModelCache(options.cacheDirName, options.requiredFiles)
    env.useCustomCache = true
    env.customCache = opfsCache
    env.useBrowserCache = false
    env.useFSCache = false

    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        navigator.storage.persist().catch(() => {})
    }

    if (options.ortWasmUrl && env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = {
            wasm: resolveWasmUrl(options.ortWasmUrl),
        }
        env.backends.onnx.wasm.numThreads = options.numThreads ?? 1
    }

    return opfsCache
}

/**
 * Maps WebGPU/ONNX Runtime pipeline exceptions into standardized error objects.
 */
export function mapWebGPUError(err: unknown): Error {
    const errStr = String(err)
    if (
        errStr.includes('FP16') ||
        errStr.includes('fp16') ||
        errStr.includes('shader') ||
        errStr.includes('unsupported')
    ) {
        return new Error('WEBGPU_FP16_NOT_SUPPORTED', { cause: err })
    }
    return err instanceof Error ? err : new Error(errStr)
}
