export interface SummaryWorkerTimings {
    modelLoadMs: number
    inferenceMs: number
}

export interface SummaryResult {
    /** Generated summary text */
    text: string
    /** Summary completion timestamp in milliseconds */
    summarizedAt: number
    /** Model identifier used for summary */
    modelId: string
}

export function isSummaryResult(v: unknown): v is SummaryResult {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false
    }
    const r = v as Record<string, unknown>
    return (
        typeof r.text === 'string' &&
        typeof r.summarizedAt === 'number' &&
        Number.isFinite(r.summarizedAt) &&
        r.summarizedAt >= 0 &&
        typeof r.modelId === 'string' &&
        r.modelId.trim().length > 0
    )
}

export type SummaryWorkerInMessage =
    | { type: 'init'; modelId: string }
    | { type: 'summarize'; text: string; prompt?: string }
    | { type: 'dispose' }

export type SummaryWorkerErrorCode =
    | 'WEBGPU_NOT_AVAILABLE'
    | 'WEBGPU_FP16_NOT_SUPPORTED'
    | 'MODEL_LOAD_FAILED'
    | 'SUMMARIZE_FAILED'

export type SummaryWorkerOutMessage =
    | { type: 'ready' }
    | { type: 'download_progress'; loaded: number; total: number; file: string }
    | { type: 'summary_progress'; stage: 'model_load' | 'generating'; progress: number }
    | { type: 'result'; summaryText: string; timings: SummaryWorkerTimings }
    | { type: 'error'; message: string; code: SummaryWorkerErrorCode }
