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
import { generateThumbnail } from './thumbnail'

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
}

// ---------- handler ----------

export class OffscreenHandler {
    private timerTimeoutId: ReturnType<typeof setTimeout> | null = null
    private timerStopAtMs: number | null = null
    private timerRemainingMs: number | null = null
    private currentRecordingStartAtMs: number | null = null

    constructor(private readonly deps: OffscreenDeps) {}

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
                    console.error('Failed to generate thumbnail:', e)
                    this.deps.sendException(e, { exceptionSource: 'offscreen.stopRecording.thumbnail' })
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
}
