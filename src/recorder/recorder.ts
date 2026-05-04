import type { Output } from 'mediabunny'
import type { VideoFormat, CropRegion } from '../configuration'
import { hasVideo, hasAudio } from '../configuration'
import type { StartRecording, StartRecordingResponse } from '../message'
import type { Preview } from '../preview'
import type { Crop } from '../crop'
import { getMimeTypeFromExtension } from '../mime'
import type { AudioMixer } from './audio_mixer'
import type { MediaCapture } from './media_capture'
import type { OutputManager, PausableSource } from './output_manager'
import type { AudioSeparationManager, AudioSeparationOutputs } from './audio_separation'
import type { FileManager } from './file_manager'
import type { SubFileInfo } from '../recording_db'
import { sendException } from '../sentry'
import type { OffscreenSession } from '../offscreen_handler'

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused'

export interface RecordingConfig {
    videoFormat: VideoFormat
    recordingSize: { width: number; height: number }
    microphone: { enabled: boolean; gain: number; deviceId: string | null }
    cropping: { enabled: boolean; region: CropRegion }
    muteRecordingTab: boolean
    audioSeparation: { enabled: boolean }
}

export interface RecordingResult {
    startAtMs: number
    durationMs: number
    fileSize: number
    mainFilePath: string
    mimeType: string
    subFiles: SubFileInfo[]
}

export interface RecorderCallbacks {
    onTabTrackEnded: () => Promise<void>
    onSourceError: (error: Error) => Promise<void>
    onTick: () => Promise<void>
}

export class RecordingSession implements OffscreenSession {
    private currentState: RecorderState = 'idle'
    private mainOutput?: Output
    private separationOutputs?: AudioSeparationOutputs
    private allSources: PausableSource[] = []
    private mediaTracks: MediaStreamTrack[] = []
    private recordingStartTime = 0
    private totalPausedMs = 0
    private pausedAtMs = 0
    private recordingFileHandle?: FileSystemFileHandle
    private mainFileName = ''
    private mainMimeType = ''
    private tickTimerId?: ReturnType<typeof setInterval>
    private currentVideoTrack: MediaStreamTrack | null = null

    constructor(
        private readonly mediaCapture: MediaCapture,
        private readonly audioMixer: AudioMixer,
        private readonly outputManager: OutputManager,
        private readonly audioSeparation: AudioSeparationManager,
        private readonly fileManager: FileManager,
        private readonly preview: Preview,
        private readonly crop: Crop,
        private readonly callbacks: RecorderCallbacks,
    ) {}

    get state(): RecorderState {
        return this.currentState
    }

    async start(request: StartRecording, config: RecordingConfig): Promise<StartRecordingResponse> {
        if (this.currentState !== 'idle') {
            throw new Error('Called startRecording while recording is in progress.')
        }
        this.currentState = 'starting'

        try {
            const startAtMs = Date.now()
            const { videoFormat, recordingSize, microphone, cropping, muteRecordingTab, audioSeparation } = config

            // Prepare output file
            const fileHandle = await this.fileManager.createRecordingFile(startAtMs, videoFormat.container)
            this.recordingFileHandle = fileHandle
            this.mainFileName = fileHandle.name
            this.mainMimeType = getMimeTypeFromExtension(fileHandle.name)
            const writableStream = await fileHandle.createWritable()

            // Create main output
            this.mainOutput = this.outputManager.createOutput(writableStream, videoFormat.container)

            // Capture tab media
            const tabMedia = await this.mediaCapture.captureTab(
                request.streamId,
                recordingSize,
                videoFormat.frameRate,
                videoFormat.recordingMode,
                videoFormat.audioSampleRate,
            )

            // Capture microphone
            const micStream = await this.mediaCapture.captureMicrophone(microphone, videoFormat.audioSampleRate)

            // Mix audio streams
            let media = this.audioMixer.mix(tabMedia, micStream, microphone.gain, videoFormat.audioSampleRate)

            // Store video track for preview
            const videoTracks = tabMedia.getVideoTracks()
            if (videoTracks.length > 0) {
                this.currentVideoTrack = videoTracks[0]
            }

            // Apply cropping if enabled (video modes only)
            const croppingEnabled = cropping.enabled && hasVideo(videoFormat.recordingMode)
            if (croppingEnabled) {
                media = this.crop.getCroppedStream(media, cropping.region)
            }

            // Set up audio playback (non-muted case)
            if (!muteRecordingTab && tabMedia.getAudioTracks().length > 0) {
                this.audioMixer.setupPlayback(tabMedia, videoFormat.audioSampleRate)
            }

            // Add tracks to main output
            const hasAudioTrack = hasAudio(videoFormat.recordingMode) || (microphone.enabled && micStream != null)
            const { sources: mainSources, errorPromises } = this.outputManager.addTracks(
                this.mainOutput,
                media,
                videoFormat,
                hasAudioTrack,
            )
            this.allSources.push(...mainSources)

            // Collect all media tracks for cleanup
            this.mediaTracks = [...tabMedia.getTracks(), ...(micStream?.getTracks() ?? [])]

            // Audio separation
            if (audioSeparation.enabled) {
                try {
                    this.separationOutputs = await this.audioSeparation.createOutputs(
                        startAtMs,
                        tabMedia,
                        micStream,
                        videoFormat,
                    )
                    this.mediaTracks.push(...this.separationOutputs.clonedTracks)
                    this.allSources.push(...this.separationOutputs.sources)
                    // Report first separation error to Sentry (non-fatal)
                    Promise.all(this.separationOutputs.errorPromises).catch(e => {
                        console.error('Audio separation source error:', e)
                        sendException(e, { exceptionSource: 'recorder.audioSeparationSource' })
                    })
                } catch (e) {
                    console.error('Failed to create audio separation outputs:', e)
                    sendException(e, { exceptionSource: 'recorder.createAudioSeparation' })
                    // Non-fatal: continue without separation
                }
            }

            // Handle media source errors
            Promise.all(errorPromises)
                .catch(async e => {
                    await this.callbacks.onSourceError(e instanceof Error ? e : new Error(String(e)))
                })
                .catch(e => {
                    console.error(e)
                    sendException(e, { exceptionSource: 'recorder.sourceErrorCallback' })
                })

            // Start outputs
            this.recordingStartTime = startAtMs
            await this.mainOutput.start()
            if (this.separationOutputs?.tabOutput) await this.separationOutputs.tabOutput.start()
            if (this.separationOutputs?.micOutput) await this.separationOutputs.micOutput.start()

            // Listen for tab track ending
            const [tabTrack] = tabMedia.getTracks()
            tabTrack?.addEventListener('ended', async () => {
                console.debug('tabTrack ended, event triggered')
                await this.callbacks.onTabTrackEnded().catch(e => {
                    console.error(e)
                    sendException(e, { exceptionSource: 'recorder.tabTrackEnded' })
                })
            })

            // Mark state
            this.currentState = 'recording'

            // Start periodic tick
            this.tickTimerId = setInterval(async () => {
                await this.callbacks.onTick().catch(e => {
                    console.error('Failed to send recording tick:', e)
                    sendException(e, { exceptionSource: 'recorder.tick' })
                })
            }, 60_000)

            return {
                startAtMs,
                mainFilePath: this.mainFileName,
                mimeType: this.mainMimeType,
                recordingMode: videoFormat.recordingMode,
                micEnabled: microphone.enabled && micStream != null,
            }
        } catch (e) {
            // Cancel any outputs that were created/started to prevent zombie recordings
            await this.mainOutput?.cancel().catch(() => {})
            if (this.separationOutputs) {
                await this.audioSeparation.cancelAll(this.separationOutputs).catch(() => {})
            }
            this.cleanup()
            throw e
        }
    }

    async stop(): Promise<RecordingResult | null> {
        if (this.mainOutput == null) {
            this.cleanup()
            return null
        }
        if (this.mainOutput.state !== 'started') return null

        // If paused, resume sources before finalizing so the encoder can flush
        if (this.currentState === 'paused') {
            this.totalPausedMs += Date.now() - this.pausedAtMs
            this.pausedAtMs = 0
            for (const source of this.allSources) source.resume()
        }

        try {
            this.preview.stop()

            // Finalize sub outputs (errors don't affect main recording)
            if (this.separationOutputs) {
                await this.audioSeparation.finalizeAll(this.separationOutputs).catch(e => {
                    console.error('Audio separation finalize error:', e)
                    sendException(e, { exceptionSource: 'recorder.audioSeparationFinalize' })
                })
            }
            await this.mainOutput.finalize()

            const file = await this.recordingFileHandle?.getFile()
            const duration = Date.now() - this.recordingStartTime - this.totalPausedMs
            console.info(`stopped: duration=${duration / 1000}s (paused: ${this.totalPausedMs / 1000}s)`)

            // Collect sub-file info
            const subFiles = this.separationOutputs
                ? await this.audioSeparation.getSubFileInfos(this.separationOutputs)
                : []

            return {
                startAtMs: this.recordingStartTime,
                durationMs: duration,
                fileSize: file?.size ?? 0,
                mainFilePath: this.mainFileName,
                mimeType: this.mainMimeType,
                subFiles,
            }
        } finally {
            this.cleanup()
        }
    }

    async cancel(): Promise<number> {
        console.warn('cancel recording...')
        try {
            this.preview.stop()
            const promises: Array<Promise<void>> = []
            if (this.mainOutput) {
                promises.push(
                    this.mainOutput.cancel().catch(cause => {
                        throw new Error('Main output cancel error', { cause })
                    }),
                )
            }
            if (this.separationOutputs) {
                promises.push(
                    this.audioSeparation.cancelAll(this.separationOutputs).catch(cause => {
                        throw new Error('Audio separation cancel error', { cause })
                    }),
                )
            }
            const failures = (await Promise.allSettled(promises))
                .filter(result => result.status === 'rejected')
                .map(result => result.reason)
            if (failures.length === 1) throw failures[0]
            if (failures.length > 1)
                throw new AggregateError(failures, 'Multiple recorder cancellation operations failed')
            return this.recordingStartTime > 0 ? Date.now() - this.recordingStartTime : 0
        } finally {
            this.cleanup()
        }
    }

    pause(): void {
        if (this.currentState !== 'recording') {
            throw new Error(`Cannot pause in state '${this.currentState}'`)
        }
        this.pausedAtMs = Date.now()
        for (const source of this.allSources) source.pause()
        this.currentState = 'paused'
    }

    resume(): void {
        if (this.currentState !== 'paused') {
            throw new Error(`Cannot resume in state '${this.currentState}'`)
        }
        this.totalPausedMs += Date.now() - this.pausedAtMs
        this.pausedAtMs = 0
        for (const source of this.allSources) source.resume()
        this.currentState = 'recording'
    }

    get isPaused(): boolean {
        return this.currentState === 'paused'
    }

    get elapsedPausedMs(): number {
        return this.totalPausedMs
    }

    startPreview(): void {
        if (this.currentVideoTrack != null) {
            this.preview.start(this.currentVideoTrack)
        }
    }

    stopPreview(): void {
        this.preview.stop()
    }

    updateCropRegion(region: CropRegion): void {
        this.crop.region = region
    }

    private cleanup(): void {
        if (this.tickTimerId != null) {
            clearInterval(this.tickTimerId)
            this.tickTimerId = undefined
        }
        this.mainOutput = undefined
        this.separationOutputs = undefined
        this.allSources = []
        this.recordingStartTime = 0
        this.totalPausedMs = 0
        this.pausedAtMs = 0
        this.recordingFileHandle = undefined
        this.mediaTracks.forEach(t => t.stop())
        this.mediaTracks = []
        this.currentVideoTrack = null
        this.currentState = 'idle'
    }
}
