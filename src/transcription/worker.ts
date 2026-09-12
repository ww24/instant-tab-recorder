/* eslint-disable unicorn/require-post-message-target-origin */
import {
    pipeline,
    env,
    PreTrainedModel,
    PretrainedConfig,
    Tensor,
    type AutomaticSpeechRecognitionPipeline,
    type AutomaticSpeechRecognitionOutput,
    type ProgressInfo,
} from '@huggingface/transformers'
// @ts-ignore -- Vite `?url` asset import has no type declarations
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { OPFSModelCache } from './opfs_model_cache'
import { normalizeLoudness } from './loudness'
import { cleanTranscriptionText } from './utils'
import { VAD_MODEL_REPO } from './model_files'
import type { WorkerInMessage, WorkerOutMessage, TranscriptionSegment, WorkerTimings } from './types'

// Configure environment
env.allowRemoteModels = false
env.allowLocalModels = true
env.useWasmCache = false

// Initialize OPFS cache for permanent model file caching
const opfsCache = new OPFSModelCache()
env.useCustomCache = true
env.customCache = opfsCache
env.useBrowserCache = false
env.useFSCache = false

if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {})
}

function resolveWasmUrl(url: string): string {
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
    return new URL(url, import.meta.url).href
}

// Configure ONNX Runtime Web WASM path via Vite bundled asset
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = {
        wasm: resolveWasmUrl(ortWasmUrl),
    }
    env.backends.onnx.wasm.numThreads = 1
}

interface SpeechInterval {
    start: number // seconds
    end: number // seconds
    startIndex: number
    endIndex: number
}

interface SileroVADOutput {
    stateN: Tensor
    output: Tensor
}

class SileroVADManager {
    private static instance: PreTrainedModel | null = null

    static async getInstance(): Promise<PreTrainedModel> {
        if (this.instance) return this.instance
        // Load cached Silero VAD model from OPFS (local_files_only ensures no remote request)
        this.instance = await PreTrainedModel.from_pretrained(VAD_MODEL_REPO, {
            config: new PretrainedConfig({
                model_type: 'custom',
                architectures: ['BertModel'],
                sampling_rate: [8000, 16000],
                state_dim: 128,
                num_layers: 2,
            }),
            dtype: 'fp32',
            local_files_only: true,
        })
        return this.instance
    }

    static async getSpeechTimestamps(
        audio: Float32Array,
        vadModel: PreTrainedModel,
        threshold = 0.5,
        minSpeechDurationMs = 250,
        minSilenceDurationMs = 300,
        speechPadMs = 100,
    ): Promise<SpeechInterval[]> {
        const sampleRate = 16000
        const windowSize = 512
        const contextSize = 64
        let state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
        const sr = new Tensor('int64', new BigInt64Array([16000n]), [1])

        const minSpeechSamples = (minSpeechDurationMs * sampleRate) / 1000
        const minSilenceSamples = (minSilenceDurationMs * sampleRate) / 1000
        const padSamples = (speechPadMs * sampleRate) / 1000

        let context = new Float32Array(contextSize)
        let triggered = false
        let tempStart = 0
        let prevEnd = 0
        let currentSpeechSamples = 0

        const speeches: SpeechInterval[] = []

        for (let i = 0; i + windowSize <= audio.length; i += windowSize) {
            const chunk = audio.subarray(i, i + windowSize)
            const inputWithContext = new Float32Array(contextSize + windowSize)
            inputWithContext.set(context, 0)
            inputWithContext.set(chunk, contextSize)
            context.set(chunk.subarray(windowSize - contextSize, windowSize))

            const input = new Tensor('float32', inputWithContext, [1, contextSize + windowSize])
            const out = (await vadModel({ input, state, sr })) as SileroVADOutput
            state = out.stateN
            const prob = Number(out.output.data[0])

            const currentSample = i + windowSize

            if (prob >= threshold) {
                if (!triggered) {
                    triggered = true
                    tempStart = i
                }
                currentSpeechSamples += windowSize
                prevEnd = currentSample
            } else {
                if (triggered) {
                    const silenceDuration = currentSample - prevEnd
                    if (silenceDuration >= minSilenceSamples) {
                        if (currentSpeechSamples >= minSpeechSamples) {
                            const startIdx = Math.max(0, tempStart - padSamples)
                            const endIdx = Math.min(audio.length, prevEnd + padSamples)
                            speeches.push({
                                start: startIdx / sampleRate,
                                end: endIdx / sampleRate,
                                startIndex: startIdx,
                                endIndex: endIdx,
                            })
                        }
                        triggered = false
                        currentSpeechSamples = 0
                    }
                }
            }
        }

        // Trailing speech segment
        if (triggered && currentSpeechSamples >= minSpeechSamples) {
            const startIdx = Math.max(0, tempStart - padSamples)
            const endIdx = Math.min(audio.length, prevEnd + padSamples)
            speeches.push({
                start: startIdx / sampleRate,
                end: endIdx / sampleRate,
                startIndex: startIdx,
                endIndex: endIdx,
            })
        }

        // Merge adjacent intervals if gap is less than 0.5s to preserve sentence continuity
        const merged: SpeechInterval[] = []
        for (const interval of speeches) {
            if (merged.length === 0) {
                merged.push(interval)
            } else {
                const last = merged[merged.length - 1]
                if (interval.start - last.end < 0.5) {
                    last.end = interval.end
                    last.endIndex = interval.endIndex
                } else {
                    merged.push(interval)
                }
            }
        }

        return merged
    }

    static async dispose(): Promise<void> {
        if (this.instance) {
            try {
                await this.instance.dispose()
            } catch (e) {
                console.warn('Error disposing Silero VAD model:', e)
            }
            this.instance = null
        }
    }
}

class WhisperPipelineManager {
    private static instance: AutomaticSpeechRecognitionPipeline | null = null
    private static currentModelId: string | null = null

    static async getInstance(
        modelId: string,
        onProgress?: (progress: { loaded: number; total: number; file: string }) => void,
    ): Promise<AutomaticSpeechRecognitionPipeline> {
        if (this.instance && this.currentModelId === modelId) {
            return this.instance
        }

        await this.dispose()

        // Verify WebGPU availability
        if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
            throw new Error('WEBGPU_NOT_AVAILABLE')
        }

        const dtype = {
            encoder_model: 'fp16',
            decoder_model_merged: 'q4f16',
        } as const

        try {
            this.instance = await pipeline('automatic-speech-recognition', modelId, {
                device: 'webgpu',
                dtype,
                use_external_data_format: {
                    'encoder_model.onnx': true,
                },
                local_files_only: true,
                progress_callback: (info: ProgressInfo) => {
                    if (onProgress && 'file' in info && info.file) {
                        onProgress({
                            loaded: 'loaded' in info ? info.loaded : 0,
                            total: 'total' in info ? info.total : 0,
                            file: info.file,
                        })
                    }
                },
            })
            this.currentModelId = modelId
            return this.instance
        } catch (err: unknown) {
            const errStr = String(err)
            if (
                errStr.includes('FP16') ||
                errStr.includes('fp16') ||
                errStr.includes('shader') ||
                errStr.includes('unsupported')
            ) {
                throw new Error('WEBGPU_FP16_NOT_SUPPORTED', { cause: err })
            }
            throw err
        }
    }

    static async dispose(): Promise<void> {
        if (this.instance) {
            try {
                await this.instance.dispose()
            } catch (e) {
                console.warn('Error disposing Whisper model:', e)
            }
            this.instance = null
            this.currentModelId = null
        }
    }
}

let configuredLanguage: string
let transcribeModelId: string

self.addEventListener('message', async (event: MessageEvent<WorkerInMessage>) => {
    const message = event.data

    try {
        switch (message.type) {
            case 'init': {
                configuredLanguage = message.language || 'english'
                transcribeModelId = message.modelId
                // 1. Check WebGPU
                if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                    self.postMessage({
                        type: 'error',
                        code: 'WEBGPU_NOT_AVAILABLE',
                        message: 'WebGPU is not supported or available on this device.',
                    } satisfies WorkerOutMessage)
                    return
                }

                // 2. Load Silero VAD
                try {
                    await SileroVADManager.getInstance()
                } catch (e) {
                    self.postMessage({
                        type: 'error',
                        code: 'MODEL_LOAD_FAILED',
                        message: `Failed to load Silero VAD model: ${e instanceof Error ? e.message : String(e)}`,
                    } satisfies WorkerOutMessage)
                    return
                }

                // 3. Load Whisper model
                try {
                    await WhisperPipelineManager.getInstance(transcribeModelId, progress => {
                        self.postMessage({
                            type: 'download_progress',
                            loaded: progress.loaded,
                            total: progress.total,
                            file: progress.file,
                        } satisfies WorkerOutMessage)
                    })
                } catch (e) {
                    const errMessage = e instanceof Error ? e.message : String(e)
                    if (errMessage === 'WEBGPU_NOT_AVAILABLE') {
                        self.postMessage({
                            type: 'error',
                            code: 'WEBGPU_NOT_AVAILABLE',
                            message: 'WebGPU is not available.',
                        } satisfies WorkerOutMessage)
                        return
                    }
                    if (errMessage === 'WEBGPU_FP16_NOT_SUPPORTED') {
                        self.postMessage({
                            type: 'error',
                            code: 'WEBGPU_FP16_NOT_SUPPORTED',
                            message: 'WebGPU FP16 is not supported by your GPU hardware.',
                        } satisfies WorkerOutMessage)
                        return
                    }
                    self.postMessage({
                        type: 'error',
                        code: 'MODEL_LOAD_FAILED',
                        message: `Failed to load Whisper model: ${errMessage}`,
                    } satisfies WorkerOutMessage)
                    return
                }

                self.postMessage({ type: 'ready' } satisfies WorkerOutMessage)
                break
            }

            case 'transcribe': {
                // 1. Loudness Normalization
                const t0 = performance.now()
                self.postMessage({
                    type: 'transcribe_progress',
                    stage: 'loudness',
                    progress: 0,
                } satisfies WorkerOutMessage)

                const processedAudio = normalizeLoudness(message.audio, {
                    targetLufs: -20.0,
                    sampleRate: 16000,
                    inPlace: false,
                })
                const loudnessNormMs = Math.round(performance.now() - t0)

                // 2. Silero VAD Detection
                const t1 = performance.now()
                self.postMessage({
                    type: 'transcribe_progress',
                    stage: 'vad',
                    progress: 0,
                } satisfies WorkerOutMessage)

                const vadModel = await SileroVADManager.getInstance()
                const speechIntervals = await SileroVADManager.getSpeechTimestamps(
                    processedAudio,
                    vadModel,
                    0.5,
                    250,
                    300,
                    100,
                )
                const vadMs = Math.round(performance.now() - t1)

                if (speechIntervals.length === 0) {
                    const timings: WorkerTimings = {
                        loudnessNormMs,
                        vadMs,
                        inferenceMs: 0,
                    }
                    self.postMessage({
                        type: 'result',
                        segments: [],
                        timings,
                    } satisfies WorkerOutMessage)
                    return
                }

                // 3. Speech Recognition with Whisper
                const transcriber = await WhisperPipelineManager.getInstance(transcribeModelId)

                const segments: TranscriptionSegment[] = []
                let inferenceMsTotal = 0

                for (let i = 0; i < speechIntervals.length; i++) {
                    const interval = speechIntervals[i]
                    self.postMessage({
                        type: 'transcribe_progress',
                        stage: 'inference',
                        progress: i / speechIntervals.length,
                    } satisfies WorkerOutMessage)

                    const slice = processedAudio.subarray(interval.startIndex, interval.endIndex)
                    const transcriberOptions: NonNullable<Parameters<AutomaticSpeechRecognitionPipeline>[1]> = {
                        task: 'transcribe',
                        return_timestamps: true,
                        chunk_length_s: 30,
                        stride_length_s: 5,
                        condition_on_previous_text: false,
                        temperature: 0.0,
                        repetition_penalty: 1.2,
                        no_repeat_ngram_size: 4,
                        language: configuredLanguage,
                    }

                    const tInferStart = performance.now()
                    const output = (await transcriber(slice, transcriberOptions)) as AutomaticSpeechRecognitionOutput
                    inferenceMsTotal += performance.now() - tInferStart

                    if (output && typeof output === 'object') {
                        const sliceText = cleanTranscriptionText(output.text || '')
                        if (sliceText) {
                            if (Array.isArray(output.chunks) && output.chunks.length > 0) {
                                for (const chunk of output.chunks) {
                                    const relStart = chunk.timestamp[0] ?? 0
                                    const relEnd = chunk.timestamp[1] ?? interval.end - interval.start
                                    const chunkText = cleanTranscriptionText(chunk.text || '')
                                    if (chunkText) {
                                        const absStart = Number((interval.start + relStart).toFixed(3))
                                        const absEnd = Number((interval.start + relEnd).toFixed(3))
                                        segments.push({
                                            startSec: absStart,
                                            endSec: absEnd,
                                            text: chunkText,
                                        })
                                    }
                                }
                            } else {
                                segments.push({
                                    startSec: Number(interval.start.toFixed(3)),
                                    endSec: Number(interval.end.toFixed(3)),
                                    text: sliceText,
                                })
                            }
                        }
                    }
                }

                const timings: WorkerTimings = {
                    loudnessNormMs,
                    vadMs,
                    inferenceMs: Math.round(inferenceMsTotal),
                }

                self.postMessage({
                    type: 'result',
                    segments,
                    timings,
                } satisfies WorkerOutMessage)
                break
            }

            case 'dispose': {
                await SileroVADManager.dispose()
                await WhisperPipelineManager.dispose()
                break
            }
        }
    } catch (e) {
        self.postMessage({
            type: 'error',
            code: 'TRANSCRIBE_FAILED',
            message: e instanceof Error ? e.message : String(e),
        } satisfies WorkerOutMessage)
    }
})
