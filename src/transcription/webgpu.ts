interface GPUAdapterFeatures {
    has(name: string): boolean
}

interface GPUAdapterLike {
    readonly features?: GPUAdapterFeatures
}

interface GPULike {
    requestAdapter(options?: unknown): Promise<GPUAdapterLike | null>
}

interface NavigatorWithGPU {
    gpu?: GPULike
}

export type WebGPUSupportReason = 'no-webgpu' | 'no-shader-f16'

export interface WebGPUSupportResult {
    supported: boolean
    reason?: WebGPUSupportReason
}

/**
 * Checks if the browser environment supports WebGPU and the shader-f16 feature.
 */
export async function checkWebGPUSupport(): Promise<WebGPUSupportResult> {
    if (typeof navigator === 'undefined') {
        return { supported: false, reason: 'no-webgpu' }
    }

    const nav = navigator as unknown as NavigatorWithGPU
    if (!nav.gpu || typeof nav.gpu.requestAdapter !== 'function') {
        return { supported: false, reason: 'no-webgpu' }
    }

    try {
        const adapter = await nav.gpu.requestAdapter()
        if (!adapter) {
            return { supported: false, reason: 'no-webgpu' }
        }

        if (!adapter.features || typeof adapter.features.has !== 'function' || !adapter.features.has('shader-f16')) {
            return { supported: false, reason: 'no-shader-f16' }
        }

        return { supported: true }
    } catch {
        return { supported: false, reason: 'no-webgpu' }
    }
}
