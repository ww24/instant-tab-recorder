/* oxlint-disable unicorn/require-post-message-target-origin */
import type { Configuration, RecordingInfo, Resolution, CropRegion } from './configuration'
import type {
    Message,
    StartRecording,
    StartRecordingResponse,
    StartTrigger,
    Trigger,
    TimerExpiredMessage,
    TimerUpdatedMessage,
} from './message'
import type { RecordingConfig, RecordingResult } from './recorder'
import type { Event, ExceptionMetadata } from './sentry_event'
import type { RecordingDB, RecordingRecord } from './recording_db'
import { generateThumbnail, NoVideoError } from './thumbnail'
import { checkMediaHasAudio, extractAudioStream } from './transcription/audio_extractor'
import { segmentsToVtt } from './transcription/vtt'
import type { WorkerOutMessage } from './transcription/types'
import type { CheckWhisperModelResponse } from './message'

// ---------- dependency interfaces ----------

export interface OffscreenSession {
    start(request: StartRecording, config: RecordingConfig): Promise<StartRecordingResponse>
    stop(): Promise<RecordingResult | null>
    cancel(): Promise<number>
    pause(): void
    resume(): void
    readonly isPaused: boolean
    readonly elapsedPausedMs: number
    startPreview(): void
    stopPreview(): void
    updateCropRegion(region: CropRegion): void
}

export interface OffscreenDeps {
    getRecordingInfo(tabSize: Resolution): RecordingInfo
    getConfiguration(): Configuration
    mergeRemoteConfiguration(remote: Configuration): void
    session: OffscreenSession
    checkStoragePersisted(): Promise<boolean>
    sendEvent(e: Event): void
    sendException(e: unknown, meta: ExceptionMetadata): void
    flush(): Promise<void>
    sendRuntimeMessage(msg: Message): Promise<unknown>
    getLocationHash(): string
    setLocationHash(hash: string): void
    recordingDB: RecordingDB
    getVideoFile(path: string): Promise<File>
    saveVttFile(path: string, content: string): Promise<void>
    checkWhisperModel(): Promise<CheckWhisperModelResponse>
    deleteWhisperModel(): Promise<void>
}

// ---------- handler ----------

export class OffscreenHandler {
    private timerTimeoutId: ReturnType<typeof setTimeout> | null = null
    private timerStopAtMs: number | null = null
    private timerRemainingMs: number | null = null
    private currentRecordingStartAtMs: number | null = null
    private activeTranscriptionRecordedAt: number | null = null

    constructor(private readonly deps: OffscreenDeps) {}

    handleMessage(message: Message): Promise<StartRecordingResponse | CheckWhisperModelResponse | void> | null {
        switch (message.type) {
            case 'start-recording':
                return this.handleStartRecording(message.data, message.trigger)
            case 'stop-recording':
                return this.handleStopRecording(message.trigger)
            case 'pause-recording':
                return this.handlePauseRecording()
            case 'resume-recording':
                return this.handleResumeRecording()
            case 'cancel-recording':
                return this.handleCancelRecording()
            case 'save-config-local':
                return this.handleSaveConfigLocal(message.data)
            case 'update-recording-timer':
                return this.handleUpdateRecordingTimer(message.enabled, message.durationMinutes)
            case 'exception':
                return Promise.reject(message.data)
            case 'sentry-event':
                this.deps.sendEvent(message.event)
                return this.deps.flush()
            case 'preview-control':
                return this.handlePreviewControl(message.action)
            case 'update-crop-region':
                return this.handleUpdateCropRegion(message.region)
            case 'start-transcription':
                if (message.target !== 'offscreen') return null
                this.handleStartTranscription(message.recordedAt).catch(e => {
                    console.error('[Offscreen] start-transcription failed:', e)
                })
                return Promise.resolve()
            case 'download-whisper-model':
                if (message.target !== 'offscreen') return null
                this.handleDownloadWhisperModel().catch(e => {
                    console.error('[Offscreen] download-whisper-model failed:', e)
                })
                return Promise.resolve()
            case 'delete-whisper-model':
                return this.deps.deleteWhisperModel()
            case 'check-whisper-model':
                return this.deps.checkWhisperModel()
        }
        return null
    }

    private async handleStartRecording(data: StartRecording, trigger: StartTrigger): Promise<StartRecordingResponse> {
        const { videoFormat, recordingSize } = this.deps.getRecordingInfo(data.tabSize)
        const config = this.deps.getConfiguration()

        const opfsPersisted = await this.deps.checkStoragePersisted()
        if (!opfsPersisted) {
            console.warn('OPFS persist: permission denied')
        }
        this.deps.sendEvent({
            type: 'start_recording',
            tags: {
                trigger,
                state: { opfsPersisted },
            },
        })

        const response = await this.deps.session.start(data, {
            videoFormat,
            recordingSize,
            microphone: config.microphone,
            cropping: config.cropping,
            muteRecordingTab: config.muteRecordingTab,
            audioSeparation: config.audioSeparation,
        })

        if (config.recordingTimer.enabled && config.recordingTimer.durationMinutes > 0) {
            this.setRecordingTimer(config.recordingTimer.durationMinutes)
            response.stopAtMs = this.timerStopAtMs ?? undefined
        }

        this.deps.setLocationHash('recording')

        // Mark any leftover "recording" status record as "canceled"
        try {
            await this.deps.recordingDB.markStaleRecordingAsCanceled()
        } catch (e) {
            console.error('Failed to mark stale recording as canceled:', e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.startRecording.markStaleCanceled' })
        }

        // Write initial record to IndexedDB
        this.currentRecordingStartAtMs = response.startAtMs
        try {
            const record: RecordingRecord = {
                recordedAt: response.startAtMs,
                mainFilePath: response.mainFilePath,
                mimeType: response.mimeType,
                title: response.mainFilePath,
                status: 'recording',
                durationMs: null,
                fileSize: 0,
                subFiles: [],
            }
            await this.deps.recordingDB.put(record)
        } catch (e) {
            console.error('Failed to write initial IndexedDB record:', e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.startRecording.indexedDB' })
        }

        return response
    }

    private async handleStopRecording(trigger: Trigger): Promise<void> {
        try {
            const result = await this.deps.session.stop()
            if (result) {
                // Generate thumbnail from the recorded video (non-fatal)
                let thumbnail: Blob | null = null
                try {
                    const videoFile = await this.deps.getVideoFile(result.mainFilePath)
                    thumbnail = await generateThumbnail(videoFile)
                } catch (e) {
                    if (!(e instanceof NoVideoError)) {
                        console.error('Failed to generate thumbnail:', e)
                        this.deps.sendException(e, { exceptionSource: 'offscreen.stopRecording.thumbnail' })
                    }
                }

                // Update IndexedDB record with final metadata
                try {
                    const record: RecordingRecord = {
                        recordedAt: result.startAtMs,
                        mainFilePath: result.mainFilePath,
                        mimeType: result.mimeType,
                        title: result.mainFilePath,
                        status: 'completed',
                        durationMs: result.durationMs,
                        fileSize: result.fileSize,
                        subFiles: result.subFiles,
                        thumbnail,
                    }
                    await this.deps.recordingDB.put(record)
                } catch (e) {
                    console.error('Failed to update IndexedDB record:', e)
                    this.deps.sendException(e, { exceptionSource: 'offscreen.stopRecording.indexedDB' })
                }
                this.deps.sendEvent({
                    type: 'stop_recording',
                    metrics: {
                        trigger,
                        recording: {
                            durationSec: result.durationMs / 1000,
                            filesize: result.fileSize,
                        },
                    },
                })
            }
        } catch (e) {
            console.error(e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.stopRecording' })
        } finally {
            this.currentRecordingStartAtMs = null
            this.clearRecordingTimer()
            this.deps.setLocationHash('')
        }
        await this.deps.flush()
    }

    private async handleCancelRecording(): Promise<void> {
        let durationSec = 0
        try {
            durationSec = (await this.deps.session.cancel()) / 1000
        } catch (e) {
            console.error(e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.cancelRecording' })
        } finally {
            this.deps.sendEvent({
                type: 'unexpected_stop',
                metrics: {
                    recording: { durationSec },
                },
            })

            // Mark the IndexedDB record for cancelled recording as canceled
            if (this.currentRecordingStartAtMs != null) {
                try {
                    await this.deps.recordingDB.markStaleRecordingAsCanceled()
                } catch (e) {
                    console.error('Failed to mark cancelled recording as canceled:', e)
                    this.deps.sendException(e, { exceptionSource: 'offscreen.cancelRecording.indexedDB' })
                }
                this.currentRecordingStartAtMs = null
            }
            this.clearRecordingTimer()
            this.deps.setLocationHash('')
        }
        await this.deps.flush()
    }

    private async handlePreviewControl(action: 'start' | 'stop'): Promise<void> {
        if (action === 'start') {
            this.deps.session.startPreview()
        } else {
            this.deps.session.stopPreview()
        }
    }

    private async handleUpdateCropRegion(region: CropRegion): Promise<void> {
        this.deps.session.updateCropRegion(region)
    }

    private async handlePauseRecording(): Promise<void> {
        this.deps.session.pause()
        this.pauseRecordingTimer()
    }

    private async handleResumeRecording(): Promise<void> {
        this.deps.session.resume()
        await this.resumeRecordingTimer()
    }

    private async handleSaveConfigLocal(data: Configuration): Promise<void> {
        this.deps.mergeRemoteConfiguration(data)
        await this.deps.flush()
    }

    private async handleUpdateRecordingTimer(enabled: boolean, durationMinutes: number): Promise<void> {
        if (this.deps.getLocationHash() !== '#recording') return
        if (enabled && durationMinutes > 0) {
            this.setRecordingTimer(durationMinutes)
        } else {
            this.clearRecordingTimer()
        }
        await this.sendTimerUpdated()
    }

    // ---------- timer helpers ----------

    private setRecordingTimer(durationMinutes: number): void {
        this.clearRecordingTimer()
        const durationMs = durationMinutes * 60 * 1000
        this.timerStopAtMs = Date.now() + durationMs
        this.timerTimeoutId = setTimeout(async () => {
            this.timerTimeoutId = null
            this.timerStopAtMs = null
            try {
                const msg: TimerExpiredMessage = { type: 'timer-expired' }
                await this.deps.sendRuntimeMessage(msg)
            } catch (e) {
                console.error('Failed to send timer-expired message:', e)
            }
        }, durationMs)
    }

    private clearRecordingTimer(): void {
        if (this.timerTimeoutId != null) {
            clearTimeout(this.timerTimeoutId)
            this.timerTimeoutId = null
        }
        this.timerStopAtMs = null
        this.timerRemainingMs = null
    }

    private pauseRecordingTimer(): void {
        if (this.timerTimeoutId == null || this.timerStopAtMs == null) return
        this.timerRemainingMs = Math.max(0, this.timerStopAtMs - Date.now())
        clearTimeout(this.timerTimeoutId)
        this.timerTimeoutId = null
        this.timerStopAtMs = null
        // Don't send timer-updated here: the stale stopAtMs in the service worker state
        // is used to display "timer paused" with remaining time while recording is paused.
        // On resume, resumeRecordingTimer() sends the updated stopAtMs.
    }

    private async resumeRecordingTimer(): Promise<void> {
        if (this.timerRemainingMs == null) return
        const remainingMs = this.timerRemainingMs
        this.timerRemainingMs = null
        this.timerStopAtMs = Date.now() + remainingMs
        this.timerTimeoutId = setTimeout(async () => {
            this.timerTimeoutId = null
            this.timerStopAtMs = null
            try {
                const msg: TimerExpiredMessage = { type: 'timer-expired' }
                await this.deps.sendRuntimeMessage(msg)
            } catch (e) {
                console.error('Failed to send timer-expired message:', e)
            }
        }, remainingMs)
        await this.sendTimerUpdated()
    }

    private async sendTimerUpdated(): Promise<void> {
        const msg: TimerUpdatedMessage = { type: 'timer-updated', stopAtMs: this.timerStopAtMs }
        try {
            await this.deps.sendRuntimeMessage(msg)
        } catch (e) {
            console.error('Failed to send timer-updated message:', e)
        }
    }

    // ---------- transcription helpers ----------

    private async handleStartTranscription(recordedAt: number): Promise<void> {
        if (this.activeTranscriptionRecordedAt != null) {
            const error = 'Another transcription is already running in offscreen document.'
            await this.deps.sendRuntimeMessage({
                type: 'transcription-error',
                recordedAt,
                error,
            })
            throw new Error(error)
        }
        this.activeTranscriptionRecordedAt = recordedAt

        try {
            const record = await this.deps.recordingDB.get(recordedAt)
            if (!record) {
                throw new Error(`Recording record not found for recordedAt=${recordedAt}`)
            }

            const file = await this.deps.getVideoFile(record.mainFilePath)
            const hasAudio = await checkMediaHasAudio(file)
            if (!hasAudio) {
                throw new Error('This recording does not have an audio track.')
            }

            const config = this.deps.getConfiguration()
            const language = config.transcription.language || 'japanese'
            const estimatedDurationSec = record.durationMs ? record.durationMs / 1000 : 0

            await new Promise<void>((resolve, reject) => {
                const worker = new Worker(chrome.runtime.getURL('dist/transcription_worker.js'), { type: 'module' })
                let device: 'webgpu' | 'wasm' = 'wasm'
                const startTime = performance.now()
                let actualDurationSec = estimatedDurationSec

                // Backpressure tracking
                let pendingAcks = 0
                let ackResolve: (() => void) | null = null
                const MAX_PENDING_ACKS = 4

                const onAck = () => {
                    if (pendingAcks > 0) {
                        pendingAcks--
                    }
                    if (ackResolve && pendingAcks < MAX_PENDING_ACKS) {
                        const r = ackResolve
                        ackResolve = null
                        r()
                    }
                }

                const waitForDrain = async () => {
                    if (pendingAcks >= MAX_PENDING_ACKS) {
                        await new Promise<void>(res => {
                            ackResolve = res
                        })
                    }
                }

                let streamAborted = false

                const startAudioStreaming = async () => {
                    try {
                        for await (const chunk of extractAudioStream(file, {
                            onProgress: progress => {
                                const percent = Math.round(progress * 100)
                                this.deps.sendRuntimeMessage({
                                    type: 'transcription-progress',
                                    recordedAt,
                                    phase: 'audio-extracting',
                                    percent,
                                    status: `Audio extraction: ${percent}%`,
                                    progress: progress * 0.1, // 0 - 10%
                                })
                            },
                        })) {
                            if (streamAborted) break
                            await waitForDrain()
                            if (streamAborted) break
                            pendingAcks++
                            worker.postMessage({ type: 'audio-chunk', chunk }, [chunk.buffer])
                        }
                        if (!streamAborted) {
                            worker.postMessage({ type: 'audio-end' })
                        }
                    } catch (err) {
                        streamAborted = true
                        worker.terminate()
                        reject(err)
                    }
                }

                worker.addEventListener('message', async (e: MessageEvent<WorkerOutMessage>) => {
                    const msg = e.data
                    if (msg.type === 'status') {
                        await this.deps.sendRuntimeMessage({
                            type: 'transcription-progress',
                            recordedAt,
                            phase: msg.phase,
                            detail: msg.detail,
                            status: msg.message,
                        })
                    } else if (msg.type === 'download-progress') {
                        const p = Math.round(msg.data.progress ?? 0)
                        if (p >= 100) {
                            await this.deps.sendRuntimeMessage({
                                type: 'transcription-progress',
                                recordedAt,
                                phase: 'model-initializing',
                                percent: 100,
                                status: 'Initializing model...',
                                progress: 0.3,
                            })
                        } else {
                            await this.deps.sendRuntimeMessage({
                                type: 'transcription-progress',
                                recordedAt,
                                phase: 'model-loading',
                                percent: p,
                                status: `Loading model: ${p}%`,
                                progress: 0.1 + (p / 100) * 0.2,
                            })
                        }
                    } else if (msg.type === 'model-ready') {
                        device = msg.device as 'webgpu' | 'wasm'
                        this.deps.sendEvent({
                            type: 'transcription_start',
                            tags: { language, device },
                            metrics: { recording: { durationSec: estimatedDurationSec } },
                        })
                        await this.deps.sendRuntimeMessage({
                            type: 'transcription-progress',
                            recordedAt,
                            phase: 'model-initializing',
                            percent: 100,
                            status: 'Initializing model...',
                            progress: 0.3,
                        })
                    } else if (msg.type === 'transcribe-start') {
                        startAudioStreaming().catch(err => {
                            streamAborted = true
                            worker.terminate()
                            reject(err)
                        })
                    } else if (msg.type === 'chunk-ack') {
                        onAck()
                    } else if (msg.type === 'transcribe-segment') {
                        const effectiveDuration =
                            actualDurationSec > 0 ? actualDurationSec : Math.max(1, msg.segment.end)
                        const segProgress = Math.min(0.99, 0.3 + (msg.segment.end / effectiveDuration) * 0.7)
                        await this.deps.sendRuntimeMessage({
                            type: 'transcription-progress',
                            recordedAt,
                            status: `Transcribing: ${msg.segment.formattedEnd}`,
                            progress: segProgress,
                        })
                    } else if (msg.type === 'transcribe-complete') {
                        try {
                            actualDurationSec = msg.result.durationSeconds
                            const vttContent = segmentsToVtt(msg.result.segments)
                            const vttFileName = `video-${recordedAt}.vtt`
                            await this.deps.saveVttFile(vttFileName, vttContent)

                            record.transcriptFilePath = vttFileName
                            await this.deps.recordingDB.put(record)

                            const durationMs = Math.round(performance.now() - startTime)
                            this.deps.sendEvent({
                                type: 'transcription_end',
                                tags: { language, device, success: true },
                                metrics: { recording: { durationSec: actualDurationSec }, durationMs },
                            })

                            await this.deps.sendRuntimeMessage({
                                type: 'transcription-complete',
                                recordedAt,
                                result: msg.result,
                            })
                            worker.terminate()
                            resolve()
                        } catch (err) {
                            worker.terminate()
                            reject(err)
                        }
                    } else if (msg.type === 'error') {
                        streamAborted = true
                        const durationMs = Math.round(performance.now() - startTime)
                        this.deps.sendEvent({
                            type: 'transcription_end',
                            tags: { language, device, success: false },
                            metrics: { recording: { durationSec: actualDurationSec }, durationMs },
                        })
                        worker.terminate()
                        await this.deps.sendRuntimeMessage({
                            type: 'transcription-error',
                            recordedAt,
                            error: msg.error,
                        })
                        reject(new Error(msg.error))
                    }
                })

                worker.addEventListener('error', err => {
                    streamAborted = true
                    worker.terminate()
                    reject(err)
                })

                worker.postMessage({
                    type: 'transcribe-init',
                    modelId: 'onnx-community/whisper-large-v3-turbo',
                    device: 'auto',
                    language,
                    vadEnabled: true,
                    vadThreshold: 0.5,
                })
            })
        } finally {
            this.activeTranscriptionRecordedAt = null
        }
    }

    private async handleDownloadWhisperModel(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const worker = new Worker(chrome.runtime.getURL('dist/transcription_worker.js'), { type: 'module' })
            worker.addEventListener('message', async (e: MessageEvent<WorkerOutMessage>) => {
                const msg = e.data
                if (msg.type === 'download-progress') {
                    await this.deps.sendRuntimeMessage({
                        type: 'whisper-model-download-progress',
                        data: msg.data,
                    })
                } else if (msg.type === 'model-ready') {
                    await this.deps.sendRuntimeMessage({
                        type: 'whisper-model-download-complete',
                        success: true,
                    })
                    worker.terminate()
                    resolve()
                } else if (msg.type === 'error') {
                    await this.deps.sendRuntimeMessage({
                        type: 'whisper-model-download-complete',
                        success: false,
                        error: msg.error,
                    })
                    worker.terminate()
                    reject(new Error(msg.error))
                }
            })
            worker.addEventListener('error', err => {
                worker.terminate()
                reject(err)
            })
            worker.postMessage({
                type: 'load',
                modelId: 'onnx-community/whisper-large-v3-turbo',
                device: 'auto',
            })
        })
    }
}
