/* oxlint-disable unicorn/require-post-message-target-origin */
import './worker_shim'
import { pipeline, env, PreTrainedModel, Tensor } from '@huggingface/transformers'
import { OPFSCache, downloadWhisperModel } from './opfs_cache'
import { ModelLoadProgressTracker } from './progress_tracker'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type {
    WorkerInMessage,
    WorkerOutMessage,
    TranscriptionSegment,
    TranscriptionResult,
    DownloadProgress,
} from './types'

// Configure environment
env.allowLocalModels = true
env.useWasmCache = false

// Initialize OPFS cache for permanent model file caching (avoids re-downloads & memory heap bloat)
const opfsCache = new OPFSCache()
env.useCustomCache = true
env.customCache = opfsCache as any
env.useBrowserCache = false
env.useFSCache = false

// Wrap env.fetch to supply Content-Length for local extension assets (e.g. Silero VAD)
// where browser fetch does not provide Content-Length header, preventing buffer reallocation warnings.
const baseFetch = env.fetch
env.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await baseFetch(input, init)
    if (response && response.headers && !response.headers.get('content-length')) {
        try {
            const cloned = response.clone()
            const blob = await cloned.blob()
            const sizeStr = String(blob.size)
            const originalGet = response.headers.get.bind(response.headers)
            response.headers.get = (name: string) => {
                if (name.toLowerCase() === 'content-length') {
                    return sizeStr
                }
                return originalGet(name)
            }
        } catch {
            // Ignore cloning failure and keep original response
        }
    }
    return response
}

// Request persistent storage so browser does not evict OPFS files
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {})
}

// Configure ONNX Runtime Web WASM path via Vite bundled asset
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = {
        wasm: ortWasmUrl,
    }
    env.backends.onnx.wasm.numThreads = 1
}

const pad = (n: number) => n.toString().padStart(2, '0')

function formatSeconds(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${pad(mins)}:${pad(secs)}.${pad(ms)}`
}

const WHISPER_MODEL_ID = 'onnx-community/whisper-large-v3-turbo'

interface SpeechInterval {
    start: number // seconds
    end: number // seconds
    startIndex: number
    endIndex: number
}

class SileroVADManager {
    private static instance: any = null

    static async getInstance(onProgress?: (data: DownloadProgress) => void) {
        if (this.instance) return this.instance
        // Load bundled Silero VAD v6.2 model directly from extension assets (/models/silero-vad)
        this.instance = await PreTrainedModel.from_pretrained('/models/silero-vad', {
            config: {
                model_type: 'custom',
                architectures: ['BertModel'],
                sampling_rate: [8000, 16000],
                state_dim: 128,
                num_layers: 2,
            } as any,
            dtype: 'fp32', // Required: prevents looking for model_quantized.onnx
            local_files_only: true, // Offline guarantee: no external network access
            progress_callback: (info: any) => {
                if (onProgress) {
                    onProgress(info as DownloadProgress)
                }
            },
        })
        return this.instance
    }

    static async getSpeechTimestamps(
        audio: Float32Array,
        vadModel: any,
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
            const out = await vadModel({ input, state, sr })
            state = out.stateN
            const prob: number = out.output.data[0]

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

        // Trailing speech
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
}

class PipelineManager {
    private static instance: any = null
    private static currentCacheKey: string | null = null
    private static currentDevice: string = 'wasm'

    static async getInstance(
        modelId: string = WHISPER_MODEL_ID,
        requestedDevice: 'webgpu' | 'wasm' | 'auto' = 'auto',
        onProgress?: (data: DownloadProgress) => void,
    ) {
        let targetDevice = requestedDevice
        if (targetDevice === 'auto') {
            targetDevice = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'
        }

        const fpEncoder = targetDevice === 'webgpu' ? 'fp16' : 'fp32'
        const dtype = {
            model: fpEncoder,
            encoder_model: fpEncoder,
            decoder_model_merged: 'q4',
        }
        const cacheKey = `${modelId}::${JSON.stringify(dtype)}::${targetDevice}`

        if (this.instance) {
            if (this.currentCacheKey === cacheKey) {
                return { transcriber: this.instance, device: this.currentDevice }
            }

            // Dispose previous model instance
            try {
                if (this.instance.model?.dispose) {
                    await this.instance.model.dispose()
                } else if (typeof this.instance.dispose === 'function') {
                    await this.instance.dispose()
                }
            } catch (e) {
                console.warn('Error disposing previous model:', e)
            }
            this.instance = null
            this.currentCacheKey = null
            await new Promise(resolve => setTimeout(resolve, 50))
        }

        const loadPipelineWithDevice = async (dev: 'webgpu' | 'wasm') => {
            const currentDtype = {
                model: dev === 'webgpu' ? 'fp16' : 'fp32',
                encoder_model: dev === 'webgpu' ? 'fp16' : 'fp32',
                decoder_model_merged: 'q4',
            }
            const pipeLoader = async (dtypeToUse: any) => {
                return await pipeline('automatic-speech-recognition', modelId, {
                    device: dev,
                    dtype: dtypeToUse,
                    local_files_only: true,
                    use_external_data_format: {
                        'encoder_model.onnx': true,
                    },
                    progress_callback: (info: any) => {
                        if (onProgress) {
                            onProgress(info as DownloadProgress)
                        }
                    },
                })
            }

            try {
                return await pipeLoader(currentDtype)
            } catch (err: any) {
                if (dev === 'webgpu' && currentDtype.encoder_model === 'fp16') {
                    self.postMessage({
                        type: 'status',
                        message: 'WebGPU FP16 is unsupported, retrying with FP32 encoder...',
                    } satisfies WorkerOutMessage)
                    return await pipeLoader({
                        ...currentDtype,
                        encoder_model: 'fp32',
                    })
                }
                throw err
            }
        }

        try {
            this.instance = await loadPipelineWithDevice(targetDevice as 'webgpu' | 'wasm')
            this.currentCacheKey = cacheKey
            this.currentDevice = targetDevice
        } catch (err: any) {
            if (targetDevice === 'webgpu') {
                self.postMessage({
                    type: 'status',
                    message: `WebGPU failed, falling back to WASM: ${err?.message ?? err}`,
                } satisfies WorkerOutMessage)
                this.instance = await loadPipelineWithDevice('wasm')
                this.currentCacheKey = `${modelId}::wasm`
                this.currentDevice = 'wasm'
            } else {
                throw err
            }
        }

        return { transcriber: this.instance, device: this.currentDevice }
    }
}

interface SpeechJob {
    start: number
    end: number
    pcm: Float32Array
}

class StreamingTranscriptionSession {
    private vadModel: any = null
    private transcriber: any = null
    private vadState = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
    private sr = new Tensor('int64', new BigInt64Array([16000n]), [1])
    private vadContext = new Float32Array(64)
    private vadRemainder = new Float32Array(0)

    private isSpeechTriggered = false
    private speechStartSample = 0
    private currentSpeechChunks: Float32Array[] = []
    private currentSpeechSampleCount = 0
    private silenceSampleCount = 0

    // Pre-pad ring buffer (150ms = 2400 samples)
    private prePadSamples: Float32Array[] = []
    private prePadCount = 0

    private totalSamplesReceived = 0
    private speechIntervalsCount = 0
    private totalSpeechDurationSec = 0

    private queue: SpeechJob[] = []
    private isProcessingQueue = false
    private audioEnded = false
    private segments: TranscriptionSegment[] = []
    private segmentIdCounter = 1
    private fullText = ''
    private pureInferenceTimeMs = 0
    private startTime = 0
    private pendingAckNeeded = false

    constructor(
        private readonly modelId: string,
        private readonly device: 'webgpu' | 'wasm' | 'auto' = 'auto',
        private readonly language?: string,
        private readonly vadEnabled = true,
        private readonly vadThreshold = 0.5,
    ) {}

    async init() {
        this.startTime = performance.now()

        self.postMessage({
            type: 'status',
            message: 'Loading Whisper model...',
        } satisfies WorkerOutMessage)

        const tracker = new ModelLoadProgressTracker(this.vadEnabled)

        const { transcriber, device } = await PipelineManager.getInstance(this.modelId, this.device, progress => {
            const overall = tracker.track('whisper', progress)
            self.postMessage({
                type: 'download-progress',
                data: overall,
            } satisfies WorkerOutMessage)
        })
        this.transcriber = transcriber
        tracker.markModelComplete('whisper')

        if (this.vadEnabled) {
            self.postMessage({
                type: 'status',
                message: 'Loading Silero VAD model...',
            } satisfies WorkerOutMessage)

            this.vadModel = await SileroVADManager.getInstance(progress => {
                const overall = tracker.track('vad', progress)
                self.postMessage({
                    type: 'download-progress',
                    data: overall,
                } satisfies WorkerOutMessage)
            })
            tracker.markModelComplete('vad')
        }

        self.postMessage({
            type: 'model-ready',
            modelId: this.modelId,
            device,
        } satisfies WorkerOutMessage)

        self.postMessage({
            type: 'transcribe-start',
        } satisfies WorkerOutMessage)
    }

    async processChunk(chunk: Float32Array) {
        if (chunk.length === 0) return

        const SAMPLE_RATE = 16000
        const WINDOW_SIZE = 512
        const CONTEXT_SIZE = 64
        const MIN_SPEECH_SAMPLES = (250 * SAMPLE_RATE) / 1000 // 4000 (250ms)
        const MIN_SILENCE_SAMPLES = (500 * SAMPLE_RATE) / 1000 // 8000 (500ms)
        const SPEECH_PAD_SAMPLES = (150 * SAMPLE_RATE) / 1000 // 2400 (150ms)
        const MAX_SPEECH_SAMPLES = 28 * SAMPLE_RATE // 448000 (28s)

        if (!this.vadEnabled) {
            this.currentSpeechChunks.push(chunk)
            this.currentSpeechSampleCount += chunk.length
            this.totalSamplesReceived += chunk.length

            if (this.currentSpeechSampleCount >= 25 * SAMPLE_RATE) {
                const pcm = this.mergeChunks(this.currentSpeechChunks)
                const startSec = this.speechStartSample / SAMPLE_RATE
                const endSec = (this.speechStartSample + this.currentSpeechSampleCount) / SAMPLE_RATE
                this.speechStartSample += this.currentSpeechSampleCount
                this.currentSpeechChunks = []
                this.currentSpeechSampleCount = 0
                this.enqueueJob({ start: startSec, end: endSec, pcm })
            }
            this.handleBackpressureAck()
            return
        }

        // VAD streaming processing
        let audio: Float32Array
        if (this.vadRemainder.length > 0) {
            audio = new Float32Array(this.vadRemainder.length + chunk.length)
            audio.set(this.vadRemainder, 0)
            audio.set(chunk, this.vadRemainder.length)
            this.vadRemainder = new Float32Array(0)
        } else {
            audio = chunk
        }

        let i = 0
        while (i + WINDOW_SIZE <= audio.length) {
            const windowData = audio.subarray(i, i + WINDOW_SIZE)
            const inputWithContext = new Float32Array(CONTEXT_SIZE + WINDOW_SIZE)
            inputWithContext.set(this.vadContext, 0)
            inputWithContext.set(windowData, CONTEXT_SIZE)
            this.vadContext.set(windowData.subarray(WINDOW_SIZE - CONTEXT_SIZE, WINDOW_SIZE))

            const input = new Tensor('float32', inputWithContext, [1, CONTEXT_SIZE + WINDOW_SIZE])
            const out = await this.vadModel({ input, state: this.vadState, sr: this.sr })
            this.vadState = out.stateN
            const prob: number = out.output.data[0]

            const currentSample = this.totalSamplesReceived + i + WINDOW_SIZE

            if (prob >= this.vadThreshold) {
                if (!this.isSpeechTriggered) {
                    this.isSpeechTriggered = true
                    // Extract pre-pad
                    let prePadData = this.mergeChunks(this.prePadSamples)
                    if (prePadData.length > SPEECH_PAD_SAMPLES) {
                        prePadData = prePadData.slice(prePadData.length - SPEECH_PAD_SAMPLES)
                    }
                    this.currentSpeechChunks = prePadData.length > 0 ? [prePadData] : []
                    this.currentSpeechSampleCount = prePadData.length
                    this.speechStartSample = Math.max(0, currentSample - WINDOW_SIZE - prePadData.length)
                    this.prePadSamples = []
                    this.prePadCount = 0
                }
                this.currentSpeechChunks.push(windowData.slice())
                this.currentSpeechSampleCount += WINDOW_SIZE
                this.silenceSampleCount = 0

                // If speech exceeds MAX_SPEECH_SAMPLES, force-flush segment
                if (this.currentSpeechSampleCount >= MAX_SPEECH_SAMPLES) {
                    const pcm = this.mergeChunks(this.currentSpeechChunks)
                    const startSec = this.speechStartSample / SAMPLE_RATE
                    const endSec = (this.speechStartSample + this.currentSpeechSampleCount) / SAMPLE_RATE
                    this.enqueueJob({ start: startSec, end: endSec, pcm })

                    this.speechStartSample = currentSample
                    this.currentSpeechChunks = []
                    this.currentSpeechSampleCount = 0
                    this.silenceSampleCount = 0
                }
            } else {
                if (this.isSpeechTriggered) {
                    this.currentSpeechChunks.push(windowData.slice())
                    this.currentSpeechSampleCount += WINDOW_SIZE
                    this.silenceSampleCount += WINDOW_SIZE

                    if (this.silenceSampleCount >= MIN_SILENCE_SAMPLES) {
                        const netSpeech = this.currentSpeechSampleCount - this.silenceSampleCount
                        if (netSpeech >= MIN_SPEECH_SAMPLES) {
                            const keepSilence = Math.min(this.silenceSampleCount, SPEECH_PAD_SAMPLES)
                            const validSamples = netSpeech + keepSilence
                            const pcm = this.mergeChunks(this.currentSpeechChunks, validSamples)
                            const startSec = this.speechStartSample / SAMPLE_RATE
                            const endSec = (this.speechStartSample + validSamples) / SAMPLE_RATE
                            this.enqueueJob({ start: startSec, end: endSec, pcm })
                        }
                        this.isSpeechTriggered = false
                        this.currentSpeechChunks = []
                        this.currentSpeechSampleCount = 0
                        this.silenceSampleCount = 0
                    }
                } else {
                    // Accumulate into rolling pre-pad
                    this.prePadSamples.push(windowData.slice())
                    this.prePadCount += WINDOW_SIZE
                    while (
                        this.prePadSamples.length > 0 &&
                        this.prePadCount - this.prePadSamples[0].length >= SPEECH_PAD_SAMPLES
                    ) {
                        this.prePadCount -= this.prePadSamples[0].length
                        this.prePadSamples.shift()
                    }
                }
            }

            i += WINDOW_SIZE
        }

        if (i < audio.length) {
            this.vadRemainder = audio.slice(i)
        }

        this.totalSamplesReceived += i
        this.handleBackpressureAck()
    }

    async finishAudio() {
        this.audioEnded = true
        const SAMPLE_RATE = 16000
        const MIN_SPEECH_SAMPLES = (250 * SAMPLE_RATE) / 1000
        const SPEECH_PAD_SAMPLES = (150 * SAMPLE_RATE) / 1000

        if (!this.vadEnabled) {
            if (this.currentSpeechSampleCount > 0) {
                const pcm = this.mergeChunks(this.currentSpeechChunks)
                const startSec = this.speechStartSample / SAMPLE_RATE
                const endSec = (this.speechStartSample + this.currentSpeechSampleCount) / SAMPLE_RATE
                this.enqueueJob({ start: startSec, end: endSec, pcm })
                this.currentSpeechChunks = []
                this.currentSpeechSampleCount = 0
            }
        } else {
            if (
                this.isSpeechTriggered &&
                this.currentSpeechSampleCount - this.silenceSampleCount >= MIN_SPEECH_SAMPLES
            ) {
                const keepSilence = Math.min(this.silenceSampleCount, SPEECH_PAD_SAMPLES)
                const validSamples = this.currentSpeechSampleCount - this.silenceSampleCount + keepSilence
                const pcm = this.mergeChunks(this.currentSpeechChunks, validSamples)
                const startSec = this.speechStartSample / SAMPLE_RATE
                const endSec = (this.speechStartSample + validSamples) / SAMPLE_RATE
                this.enqueueJob({ start: startSec, end: endSec, pcm })
            }
            this.isSpeechTriggered = false
            this.currentSpeechChunks = []
            this.currentSpeechSampleCount = 0
        }

        if (this.queue.length === 0 && !this.isProcessingQueue) {
            this.finalizeResult()
        }
    }

    private enqueueJob(job: SpeechJob) {
        this.speechIntervalsCount++
        this.totalSpeechDurationSec += job.end - job.start
        this.queue.push(job)
        this.processQueue().catch(err => {
            self.postMessage({
                type: 'error',
                error: err?.message ?? String(err),
            } satisfies WorkerOutMessage)
        })
    }

    private handleBackpressureAck() {
        if (this.queue.length <= 2) {
            self.postMessage({ type: 'chunk-ack' } satisfies WorkerOutMessage)
        } else {
            this.pendingAckNeeded = true
        }
    }

    private async processQueue() {
        if (this.isProcessingQueue) return
        this.isProcessingQueue = true

        while (this.queue.length > 0) {
            const job = this.queue.shift()!
            await this.runWhisper(job)

            if (this.pendingAckNeeded && this.queue.length <= 2) {
                this.pendingAckNeeded = false
                self.postMessage({ type: 'chunk-ack' } satisfies WorkerOutMessage)
            }
        }

        this.isProcessingQueue = false
        if (this.audioEnded && this.queue.length === 0) {
            this.finalizeResult()
        }
    }

    private async runWhisper(job: SpeechJob) {
        const rangeText = `${formatSeconds(job.start)} - ${formatSeconds(job.end)}`
        self.postMessage({
            type: 'status',
            message: `Transcription in progress (${this.speechIntervalsCount}): ${rangeText}`,
            phase: 'transcribing',
            detail: rangeText,
        } satisfies WorkerOutMessage)

        const transcriberOptions: any = {
            task: 'transcribe',
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5,
            condition_on_previous_text: false,
            temperature: 0.0,
        }
        if (this.language && this.language !== 'none') {
            transcriberOptions.language = this.language
        }

        const t0 = performance.now()
        const sliceOutput = await this.transcriber(job.pcm, transcriberOptions)
        this.pureInferenceTimeMs += performance.now() - t0

        if (sliceOutput && typeof sliceOutput === 'object') {
            const sliceText = (sliceOutput.text || '').trim()
            if (sliceText) {
                if (Array.isArray(sliceOutput.chunks) && sliceOutput.chunks.length > 0) {
                    for (const chunk of sliceOutput.chunks) {
                        const relStart = chunk.timestamp?.[0] ?? 0
                        const relEnd = chunk.timestamp?.[1] ?? job.end - job.start
                        const chunkText = (chunk.text || '').trim()
                        if (chunkText) {
                            const absStart = job.start + relStart
                            const absEnd = job.start + relEnd
                            const seg: TranscriptionSegment = {
                                id: this.segmentIdCounter++,
                                start: absStart,
                                end: absEnd,
                                formattedStart: formatSeconds(absStart),
                                formattedEnd: formatSeconds(absEnd),
                                text: chunkText,
                            }
                            this.segments.push(seg)
                            self.postMessage({
                                type: 'transcribe-segment',
                                segment: seg,
                            } satisfies WorkerOutMessage)
                        }
                    }
                } else {
                    const seg: TranscriptionSegment = {
                        id: this.segmentIdCounter++,
                        start: job.start,
                        end: job.end,
                        formattedStart: formatSeconds(job.start),
                        formattedEnd: formatSeconds(job.end),
                        text: sliceText,
                    }
                    this.segments.push(seg)
                    self.postMessage({
                        type: 'transcribe-segment',
                        segment: seg,
                    } satisfies WorkerOutMessage)
                }
                this.fullText += (this.fullText ? '\n' : '') + sliceText
            }
        }
    }

    private finalizeResult() {
        const totalTimeMs = Math.round(performance.now() - this.startTime)
        const durationSeconds = this.totalSamplesReceived / 16000
        const skippedSilence = Math.max(0, durationSeconds - this.totalSpeechDurationSec)

        const result: TranscriptionResult = {
            text: this.fullText,
            segments: this.segments,
            durationSeconds,
            processingTimeMs: Math.round(this.pureInferenceTimeMs),
            totalTimeMs,
            ...(this.vadEnabled
                ? {
                      vadStats: {
                          totalDuration: durationSeconds,
                          speechDuration: this.totalSpeechDurationSec,
                          skippedSilenceDuration: skippedSilence,
                          speechSegmentCount: this.speechIntervalsCount,
                      },
                  }
                : {}),
        }

        self.postMessage({
            type: 'transcribe-complete',
            result,
        } satisfies WorkerOutMessage)
    }

    private mergeChunks(chunks: Float32Array[], maxSamples?: number): Float32Array {
        let total = 0
        for (const c of chunks) total += c.length
        const limit = maxSamples !== undefined ? Math.min(total, maxSamples) : total
        const res = new Float32Array(limit)
        let offset = 0
        for (const c of chunks) {
            if (offset >= limit) break
            const copyLen = Math.min(c.length, limit - offset)
            res.set(c.subarray(0, copyLen), offset)
            offset += copyLen
        }
        return res
    }
}

let currentSession: StreamingTranscriptionSession | null = null

self.addEventListener('message', async (event: MessageEvent<WorkerInMessage>) => {
    const message = event.data

    try {
        if (message.type === 'load') {
            self.postMessage({
                type: 'status',
                message: `Downloading model ${message.modelId}...`,
            } satisfies WorkerOutMessage)

            await downloadWhisperModel(progress => {
                self.postMessage({
                    type: 'download-progress',
                    data: progress,
                } satisfies WorkerOutMessage)
            })

            const hasAllFiles = await opfsCache.hasModel()
            if (!hasAllFiles) {
                throw new Error('Model download completed, but required files are missing in OPFS storage.')
            }

            const targetDevice =
                message.device === 'wasm'
                    ? 'wasm'
                    : typeof navigator !== 'undefined' && 'gpu' in navigator
                      ? 'webgpu'
                      : 'wasm'

            self.postMessage({
                type: 'model-ready',
                modelId: message.modelId,
                device: targetDevice,
            } satisfies WorkerOutMessage)
        } else if (message.type === 'transcribe-init') {
            currentSession = new StreamingTranscriptionSession(
                message.modelId,
                message.device ?? 'auto',
                message.language,
                message.vadEnabled,
                message.vadThreshold ?? 0.5,
            )
            await currentSession.init()
        } else if (message.type === 'audio-chunk') {
            if (!currentSession) {
                throw new Error('No active streaming transcription session.')
            }
            await currentSession.processChunk(message.chunk)
        } else if (message.type === 'audio-end') {
            if (!currentSession) {
                throw new Error('No active streaming transcription session.')
            }
            await currentSession.finishAudio()
            currentSession = null
        } else if (message.type === 'transcribe') {
            // Backwards-compatible batch transcribe: feeds audio chunk-by-chunk into StreamingTranscriptionSession
            currentSession = new StreamingTranscriptionSession(
                message.modelId,
                'auto',
                message.language,
                message.vadEnabled,
                message.vadThreshold ?? 0.5,
            )
            await currentSession.init()
            const chunkSize = 16000
            for (let offset = 0; offset < message.audio.length; offset += chunkSize) {
                const chunk = message.audio.subarray(offset, Math.min(offset + chunkSize, message.audio.length))
                await currentSession.processChunk(chunk)
            }
            await currentSession.finishAudio()
            currentSession = null
        }
    } catch (error: any) {
        self.postMessage({
            type: 'error',
            error: error?.message ?? String(error),
        } satisfies WorkerOutMessage)
    }
})
