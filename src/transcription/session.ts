/* eslint-disable unicorn/require-post-message-target-origin */
import { ALL_FORMATS, BlobSource, Input, Conversion, BufferTarget, WavOutputFormat, Output } from 'mediabunny'
import type { TranscriptionResult, WorkerInMessage, WorkerOutMessage } from './types'
import { wavToFloat32Array } from './utils'
import { TRANSCRIPTION_MODEL_REPO } from './model_files'
import type { Event } from '../sentry_event'
import { BaseMLSession, abortable, type BaseMLSessionDeps } from '../ml/base_session'
import { initializeWorker, executeWorkerTask } from '../ml/worker_client'

export interface TranscriptionSessionDeps extends BaseMLSessionDeps {
    getVideoFile(path: string): Promise<Blob>
    saveTranscription(path: string, result: TranscriptionResult): Promise<void>
    sendEvent(event: Event): void
    getLanguage?(): Promise<string>
}

/**
 * Manages audio extraction and transcription execution in the background.
 */
export class TranscriptionSession extends BaseMLSession<TranscriptionSessionDeps> {
    constructor(deps: TranscriptionSessionDeps) {
        super(deps, 'Transcription')
    }

    isTranscribing(path: string): boolean {
        return this.isTaskActive(path)
    }

    async transcribe(path: string, options?: { language?: string }): Promise<void> {
        return this.runTask(
            path,
            async (signal, setWorker) => {
                const totalStart = performance.now()

                // 1. Audio extraction via Mediabunny (cancellable before Worker is created)
                const tAudioStart = performance.now()
                const videoBlob = await abortable(this.deps.getVideoFile(path), signal)

                using input = new Input({
                    formats: ALL_FORMATS,
                    source: new BlobSource(videoBlob),
                })

                const readable = await abortable(input.canRead(), signal)
                if (!readable) {
                    throw new Error('Video format is unsupported or file is corrupted')
                }

                const target = new BufferTarget()
                const output = new Output({
                    format: new WavOutputFormat(),
                    target,
                })

                const conversion = await abortable(
                    Conversion.init({
                        input,
                        output,
                        tracks: 'primary',
                        video: { discard: true },
                        audio: {
                            numberOfChannels: 1,
                            sampleRate: 16000,
                            codec: 'pcm-f32',
                        },
                        showWarnings: false,
                    }),
                    signal,
                )

                if (!conversion.isValid) {
                    const reasons = conversion.discardedTracks.map(t => t.reason).join(', ')
                    throw new Error(`Failed to initialize audio conversion: ${reasons}`)
                }

                await abortable(conversion.execute(), signal)

                const buffer = target.buffer
                if (!buffer) {
                    throw new Error('Failed to extract audio buffer')
                }

                const float32Audio = wavToFloat32Array(buffer)
                const audioConversionMs = Math.round(performance.now() - tAudioStart)
                const videoDurationSec = float32Audio.length / 16000

                // 2. Initialize Worker
                const tModelStart = performance.now()
                const worker = this.deps.createWorker()
                setWorker(worker)

                const language = options?.language ?? (await this.deps.getLanguage?.()) ?? 'english'
                const modelId = TRANSCRIPTION_MODEL_REPO

                await abortable(
                    initializeWorker({
                        worker,
                        initMessage: { type: 'init', modelId, language },
                        errorPrefix: 'Transcription worker',
                        onDownloadProgress: (loaded, total) => {
                            this.deps
                                .broadcastMessage({
                                    type: 'transcription-progress',
                                    path,
                                    stage: 'model_load',
                                    loaded,
                                    total,
                                })
                                .catch(() => {})
                        },
                    }),
                    signal,
                )

                const modelLoadMs = Math.round(performance.now() - tModelStart)

                // 3. Execute transcription
                const resultMsg = await executeWorkerTask<
                    WorkerInMessage,
                    Extract<WorkerOutMessage, { type: 'result' }>
                >({
                    worker,
                    signal,
                    message: {
                        type: 'transcribe',
                        audio: float32Audio,
                    },
                    transfer: [float32Audio.buffer],
                    errorPrefix: 'Transcription worker',
                    isProgress: (data: unknown): data is WorkerOutMessage =>
                        typeof data === 'object' && data !== null && (data as any).type === 'transcribe_progress',
                    onProgress: (data: any) => {
                        this.deps
                            .broadcastMessage({
                                type: 'transcription-progress',
                                path,
                                stage: data.stage,
                                loaded: Math.round(data.progress * 100),
                                total: 100,
                            })
                            .catch(() => {})
                    },
                    isResult: (data: unknown): data is Extract<WorkerOutMessage, { type: 'result' }> =>
                        typeof data === 'object' && data !== null && (data as any).type === 'result',
                })

                // 4. Save result to IndexedDB
                signal.throwIfAborted()

                const transcriptionResult: TranscriptionResult = {
                    segments: resultMsg.segments,
                    transcribedAt: Date.now(),
                    modelId,
                    language,
                }

                await this.deps.saveTranscription(path, transcriptionResult)
                const totalMs = Math.round(performance.now() - totalStart)

                // 5. Send Sentry metrics
                this.deps.sendEvent({
                    type: 'transcription_complete',
                    metrics: {
                        videoDurationSec,
                        audioConversionMs,
                        modelLoadMs,
                        loudnessNormMs: resultMsg.timings.loudnessNormMs,
                        vadMs: resultMsg.timings.vadMs,
                        inferenceMs: resultMsg.timings.inferenceMs,
                        totalMs,
                        modelId,
                        language,
                        segmentCount: resultMsg.segments.length,
                    },
                })

                // 6. Broadcast completion notification
                await this.deps.broadcastMessage({
                    type: 'transcription-complete',
                    path,
                })
            },
            { errorMessageType: 'transcription-error' },
        )
    }
}
