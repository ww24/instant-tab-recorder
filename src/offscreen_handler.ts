import type { Configuration, RecordingInfo, Resolution, CropRegion } from './configuration'
import type {
    Message,
    ModelType,
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
import type { TranscriptionSession } from './transcription/session'
import type { TranscriptionModelDownloader } from './transcription/model_downloader'
import type { SummarySession } from './summary/session'
import type { SummaryModelDownloader } from './summary/model_downloader'

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
    transcriptionSession?: TranscriptionSession
    transcriptionModelDownloader?: TranscriptionModelDownloader
    summarySession?: SummarySession
    summaryModelDownloader?: SummaryModelDownloader
    closeDocument?: () => void
}

// ---------- handler ----------

export class OffscreenHandler {
    private timerTimeoutId: ReturnType<typeof setTimeout> | null = null
    private timerStopAtMs: number | null = null
    private timerRemainingMs: number | null = null
    private currentRecordingStartAtMs: number | null = null

    constructor(private readonly deps: OffscreenDeps) {}

    /**
     * Returns true if there are active recording, transcription, summary, or model download tasks.
     */
    isBusy(): boolean {
        const isRecording = this.currentRecordingStartAtMs !== null || this.deps.getLocationHash() === '#recording'
        const isTranscribing = this.deps.transcriptionSession?.hasActiveTasks() ?? false
        const isDownloading = this.deps.transcriptionModelDownloader?.isDownloading ?? false
        const isSummarizing = this.deps.summarySession?.hasActiveTasks() ?? false
        const isSummaryDownloading = this.deps.summaryModelDownloader?.isDownloading ?? false
        return isRecording || isTranscribing || isDownloading || isSummarizing || isSummaryDownloading
    }

    /**
     * Closes the offscreen document if no tasks are active.
     */
    private maybeClose(): void {
        if (!this.isBusy()) {
            this.deps.closeDocument?.()
        }
    }

    handleMessage(message: Message): Promise<StartRecordingResponse | void> | null {
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
                return this.handleStartTranscription(message.path)
            case 'query-transcription-status':
                return this.handleQueryTranscriptionStatus(message.path)
            case 'start-model-download':
                return this.handleStartModelDownload(message.modelType)
            case 'cancel-model-download':
                return this.handleCancelModelDownload(message.modelType)
            case 'query-model-download-status':
                return this.handleQueryModelDownloadStatus(message.modelType)
            case 'start-summary':
                return this.handleStartSummary(message.path)
            case 'query-summary-status':
                return this.handleQuerySummaryStatus(message.path)
            case 'cancel-tasks-for-path':
                return this.handleCancelTasksForPath(message.path)
            case 'close-offscreen-if-idle':
                this.maybeClose()
                return null
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

    private async handleStartTranscription(path: string): Promise<void> {
        if (!this.deps.transcriptionSession) {
            this.maybeClose()
            return
        }
        try {
            await this.deps.transcriptionSession.transcribe(path)
        } catch (e) {
            console.error('Transcription failed in offscreen handler:', e)
            this.deps.sendException(e, {
                exceptionSource: 'offscreen.handleStartTranscription',
                additionalMetadata: { path },
            })
        } finally {
            this.maybeClose()
        }
    }

    private async handleQueryTranscriptionStatus(path: string): Promise<void> {
        const isTranscribing = this.deps.transcriptionSession?.isTranscribing(path) ?? false
        await this.deps.sendRuntimeMessage({
            type: 'transcription-status-response',
            path,
            isTranscribing,
        })
    }

    private getModelDownloader(
        modelType: ModelType,
    ): TranscriptionModelDownloader | SummaryModelDownloader | undefined {
        return modelType === 'transcription' ? this.deps.transcriptionModelDownloader : this.deps.summaryModelDownloader
    }

    private async handleStartModelDownload(modelType: ModelType): Promise<void> {
        const downloader = this.getModelDownloader(modelType)
        if (!downloader) {
            this.maybeClose()
            return
        }
        if (downloader.isDownloading) {
            return
        }
        try {
            const startAt = performance.now()
            await downloader.download(progress => {
                this.deps
                    .sendRuntimeMessage({
                        type: 'model-download-progress',
                        modelType,
                        loaded: progress.loaded,
                        total: progress.total,
                        file: progress.file,
                        fileIndex: progress.fileIndex,
                        totalFiles: progress.totalFiles,
                    })
                    .catch(() => {})
            })
            const totalMs = Math.round(performance.now() - startAt)
            this.deps.sendEvent({
                type: 'model_download_complete',
                metrics: {
                    totalMs,
                },
            })
            await this.deps.sendRuntimeMessage({ type: 'model-download-complete', modelType })
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e)
            const isAborted =
                errorMsg === 'Model download aborted' ||
                errorMsg === 'Summary model download aborted' ||
                (downloader.aborted ?? false)
            if (isAborted) {
                console.log(`${modelType} model download aborted by user.`)
                await downloader.clearCache().catch(() => {})
                await this.deps.sendRuntimeMessage({
                    type: 'model-download-error',
                    modelType,
                    error: 'Model download aborted',
                })
                return
            }
            console.error(`${modelType} model download failed in offscreen handler:`, e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.handleStartModelDownload' })
            await this.deps.sendRuntimeMessage({ type: 'model-download-error', modelType, error: errorMsg })
        } finally {
            this.maybeClose()
        }
    }

    private async handleCancelModelDownload(modelType: ModelType): Promise<void> {
        const downloader = this.getModelDownloader(modelType)
        downloader?.abort()
        await downloader?.clearCache().catch(() => {})
        this.maybeClose()
    }

    private async handleQueryModelDownloadStatus(modelType: ModelType): Promise<void> {
        const downloader = this.getModelDownloader(modelType)
        const isDownloading = downloader?.isDownloading ?? false
        const progress = downloader?.getProgress() ?? null
        await this.deps.sendRuntimeMessage({
            type: 'model-download-status-response',
            modelType,
            isDownloading,
            progress,
        })
    }

    private async handleStartSummary(path: string): Promise<void> {
        if (!this.deps.summarySession) {
            this.maybeClose()
            return
        }
        if (this.deps.summarySession.isSummarizing(path)) {
            return
        }
        try {
            await this.deps.summarySession.summarize(path)
        } catch (e) {
            console.error('Summary failed in offscreen handler:', e)
            this.deps.sendException(e, {
                exceptionSource: 'offscreen.handleStartSummary',
                additionalMetadata: { path },
            })
        } finally {
            this.maybeClose()
        }
    }

    private async handleQuerySummaryStatus(path: string): Promise<void> {
        const isSummarizing = this.deps.summarySession?.isSummarizing(path) ?? false
        await this.deps.sendRuntimeMessage({
            type: 'summary-status-response',
            path,
            isSummarizing,
        })
    }

    private async handleCancelTasksForPath(path: string): Promise<void> {
        this.deps.transcriptionSession?.cancel(path)
        this.deps.summarySession?.cancel(path)
        this.maybeClose()
    }
}
