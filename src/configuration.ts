import {
    WebMOutputFormat,
    Mp4OutputFormat,
    OggOutputFormat,
    AdtsOutputFormat,
    FlacOutputFormat,
    QUALITY_HIGH,
    QUALITY_MEDIUM,
    QUALITY_LOW,
} from 'mediabunny'
import type { OutputFormat, Quality } from 'mediabunny'

export interface Resolution {
    width: number
    height: number
}
export interface CropRegion {
    x: number // Top-left X coordinate (px)
    y: number // Top-left Y coordinate (px)
    width: number // Width (px)
    height: number // Height (px)
}
export interface CroppingConfig {
    enabled: boolean // Cropping feature ON/OFF
    region: CropRegion // Cropping region
}
const containerFormats = ['webm', 'mp4', 'ogg', 'adts', 'flac'] as const
export type ContainerFormat = (typeof containerFormats)[number]
export function isContainerFormat(v: unknown): v is ContainerFormat {
    return containerFormats.some(f => v === f)
}

export const AUDIO_ONLY_CONTAINERS: readonly ContainerFormat[] = ['ogg', 'adts', 'flac']

export const ALL_VIDEO_CODECS = ['vp8', 'vp9', 'av1', 'avc', 'hevc'] as const
export type VideoCodecType = (typeof ALL_VIDEO_CODECS)[number]
const videoCodecs = ALL_VIDEO_CODECS
export function isVideoCodec(v: unknown): v is VideoCodecType {
    return videoCodecs.some(c => v === c)
}

export const ALL_AUDIO_CODECS = ['opus', 'aac', 'flac'] as const
export type AudioCodecType = (typeof ALL_AUDIO_CODECS)[number]
const audioCodecs = ALL_AUDIO_CODECS
export function isAudioCodec(v: unknown): v is AudioCodecType {
    return audioCodecs.some(c => v === c)
}

export function createOutputFormat(container: ContainerFormat): OutputFormat {
    switch (container) {
        case 'webm':
            return new WebMOutputFormat()
        case 'mp4':
            return new Mp4OutputFormat({ fastStart: false })
        case 'ogg':
            return new OggOutputFormat()
        case 'adts':
            return new AdtsOutputFormat()
        case 'flac':
            return new FlacOutputFormat()
    }
}

/** Available codecs per container format (dynamically queried from mediabunny) */
export function getContainerCodecs(container: ContainerFormat): { video: VideoCodecType[]; audio: AudioCodecType[] } {
    const format = createOutputFormat(container)
    const video = format.getSupportedVideoCodecs().filter(isVideoCodec)
    const audio = format.getSupportedAudioCodecs().filter(isAudioCodec)
    return { video, audio }
}

/** Container format to file extension */
export function containerExtension(container: ContainerFormat): string {
    switch (container) {
        case 'webm':
            return '.webm'
        case 'mp4':
            return '.mp4'
        case 'ogg':
            return '.ogg'
        case 'adts':
            return '.aac'
        case 'flac':
            return '.flac'
    }
}

const bitratePresets = ['high', 'medium', 'low', 'custom'] as const
export type BitratePreset = (typeof bitratePresets)[number]
export function isBitratePreset(v: unknown): v is BitratePreset {
    return bitratePresets.some(p => v === p)
}

export function resolveBitrate(preset: BitratePreset, customValue: number): number | Quality {
    switch (preset) {
        case 'high':
            return QUALITY_HIGH
        case 'medium':
            return QUALITY_MEDIUM
        case 'low':
            return QUALITY_LOW
        case 'custom':
            return customValue
    }
}

export class VideoFormat {
    constructor(
        public recordingMode: VideoRecordingMode,
        public container: ContainerFormat,
        public audioCodec: AudioCodecType,
        public audioBitratePreset: BitratePreset,
        public audioBitrate: number, // bps (used when audioBitratePreset is 'custom')
        public audioSampleRate: number,
        public videoCodec: VideoCodecType,
        public videoBitratePreset: BitratePreset,
        public videoBitrate: number, // bps (used when videoBitratePreset is 'custom')
        public frameRate: number, // fps
    ) {}

    static toReport(vf: VideoFormat, micEnabled: boolean = false): VideoFormatReport {
        const report: VideoFormatReport = { ...vf }
        const { recordingMode, audioBitratePreset, videoBitratePreset } = vf
        switch (recordingMode) {
            case 'audio-only':
                report.videoCodec = undefined
                report.videoBitratePreset = undefined
                report.videoBitrate = undefined
                report.frameRate = undefined
                break
            case 'video-only':
                if (!micEnabled) {
                    report.audioCodec = undefined
                    report.audioBitratePreset = undefined
                    report.audioBitrate = undefined
                    report.audioSampleRate = undefined
                }
                break
        }
        if (audioBitratePreset !== 'custom') {
            report.audioBitrate = undefined
        }
        if (videoBitratePreset !== 'custom') {
            report.videoBitrate = undefined
        }
        return report
    }
}

export type VideoFormatReport = Pick<VideoFormat, 'recordingMode' | 'container'> & {
    // audio
    audioCodec?: AudioCodecType
    audioBitratePreset?: BitratePreset
    audioBitrate?: number // bps (used when audioBitratePreset is 'custom')
    audioSampleRate?: number // Hz

    // video
    videoCodec?: VideoCodecType
    videoBitratePreset?: BitratePreset
    videoBitrate?: number // bps (used when videoBitratePreset is 'custom')
    frameRate?: number // fps
}

/**
 * Migrate legacy configuration that used mimeType string
 */
export function migrateFromMimeType(mimeType: string): {
    container: ContainerFormat
    videoCodec: VideoCodecType
    audioCodec: AudioCodecType
} {
    const base = mimeType.split(';')[0]
    const codecStr = mimeType.match(/codecs="?([^"]+)"?/)?.[1] ?? ''
    const codecs = codecStr.split(',').map(c => c.trim().toLowerCase())

    const container: ContainerFormat = base === 'video/mp4' ? 'mp4' : 'webm'

    let videoCodec: VideoCodecType = container === 'mp4' ? 'avc' : 'vp9'
    for (const c of codecs) {
        if (c === 'vp9') {
            videoCodec = 'vp9'
            break
        }
        if (c === 'vp8') {
            videoCodec = 'vp8'
            break
        }
        if (c === 'av1' || c.startsWith('av01')) {
            videoCodec = 'av1'
            break
        }
        if (c.startsWith('avc') || c.startsWith('h264')) {
            videoCodec = 'avc'
            break
        }
        if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) {
            videoCodec = 'hevc'
            break
        }
    }

    let audioCodec: AudioCodecType = container === 'mp4' ? 'aac' : 'opus'
    for (const c of codecs) {
        if (c === 'opus') {
            audioCodec = 'opus'
            break
        }
        if (c.startsWith('mp4a') || c === 'aac') {
            audioCodec = 'aac'
            break
        }
        if (c === 'flac') {
            audioCodec = 'flac'
            break
        }
    }

    return { container, videoCodec, audioCodec }
}
export interface ScreenRecordingSize extends Resolution {
    auto: boolean
    scale: number
}
export interface Microphone {
    enabled: boolean
    gain: number
    deviceId: string | null // null = default device, string = specific device ID
}
export interface AudioSeparation {
    enabled: boolean
}
export interface RecordingTimer {
    enabled: boolean
    durationMinutes: number
    skipStopConfirmation: boolean
}
export interface RecordingInfo {
    videoFormat: VideoFormat
    recordingSize: Resolution
}

/**
 * Sort order for recording list
 */
export type RecordingSortOrder = 'asc' | 'desc'

/**
 * UI Theme for option page
 */
const uiThemes = ['classic', 'light', 'dark', 'auto'] as const
export type UITheme = (typeof uiThemes)[number]
export function isUITheme(v: unknown): v is UITheme {
    return uiThemes.some(t => v === t)
}
const videoRecordingMode = ['video-and-audio', 'video-only', 'audio-only'] as const
export type VideoRecordingMode = (typeof videoRecordingMode)[number]
export function isVideoRecordingMode(v: unknown): v is VideoRecordingMode {
    return videoRecordingMode.some(m => v === m)
}
export function hasVideo(mode: VideoRecordingMode): boolean {
    return mode !== 'audio-only'
}
export function hasAudio(mode: VideoRecordingMode): boolean {
    return mode !== 'video-only'
}
export function isAudioOnly(mode: VideoRecordingMode): boolean {
    return mode === 'audio-only'
}

// Configuration type for sync storage (excludes device-specific settings)
export type SyncConfiguration = Omit<Configuration, 'microphone' | 'cropping'>

/**
 * Resolve the container format for separated audio files.
 * Determined solely by the audio codec: opus → ogg, aac → adts, flac → flac.
 */
export function audioSeparationContainer(audioCodec: AudioCodecType): ContainerFormat {
    switch (audioCodec) {
        case 'opus':
            return 'ogg'
        case 'aac':
            return 'adts'
        case 'flac':
            return 'flac'
        default:
            return 'mp4'
    }
}

export type RecordingTimerReport = { enabled: boolean; durationMinutes?: number; skipStopConfirmation?: boolean }

export type ConfigurationReport = Pick<
    Configuration,
    | 'windowSize'
    | 'screenRecordingSize'
    | 'openOptionPage'
    | 'muteRecordingTab'
    | 'recordingSortOrder'
    | 'audioSeparation'
    | 'uiTheme'
> & { videoFormat: VideoFormatReport } & { microphone: Omit<Microphone, 'deviceId'> } & {
    cropping: Pick<CroppingConfig, 'enabled'> & { region: Pick<CropRegion, 'width' | 'height'> }
} & { recordingTimer: RecordingTimerReport }

export class Configuration {
    public static readonly key = 'settings'
    windowSize: Resolution
    screenRecordingSize: ScreenRecordingSize
    videoFormat: VideoFormat
    enableBugTracking: boolean
    updatedAt: number
    userId: string
    openOptionPage: boolean
    muteRecordingTab: boolean
    microphone: Microphone
    cropping: CroppingConfig
    recordingSortOrder: RecordingSortOrder
    audioSeparation: AudioSeparation
    recordingTimer: RecordingTimer
    uiTheme: UITheme
    constructor() {
        this.windowSize = {
            width: 1920,
            height: 1080,
        }
        this.screenRecordingSize = {
            width: 1920,
            height: 1080,
            auto: true,
            scale: 2,
        }
        this.videoFormat = new VideoFormat(
            'video-and-audio', // recordingMode
            'webm', // container
            'opus', // audioCodec
            'high', // audioBitratePreset
            256 * 1000, // audioBitrate (256kbps)
            44100, // audioSampleRate (44.1kHz)
            'vp9', // videoCodec
            'high', // videoBitratePreset
            8 * 1000 * 1000, // videoBitrate (8mbps)
            30, // frameRate (30fps)
        )
        this.enableBugTracking = true
        this.updatedAt = 0
        this.userId = ''
        this.openOptionPage = true
        this.muteRecordingTab = false
        this.microphone = {
            enabled: false,
            gain: 1.0,
            deviceId: null,
        }
        this.cropping = {
            enabled: false,
            region: {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        }
        this.recordingSortOrder = 'asc'
        this.audioSeparation = {
            enabled: false,
        }
        this.recordingTimer = {
            enabled: false,
            durationMinutes: 30,
            skipStopConfirmation: false,
        }
        this.uiTheme = 'auto'
    }
    static restoreDefault({ userId }: Configuration): Configuration {
        const config = new Configuration()
        return { ...config, userId }
    }
    static filterForSync(config: Configuration): SyncConfiguration {
        // Exclude microphone and cropping from sync as it depends on device-specific information
        const { microphone: _m, cropping: _c, ...rest } = config
        return { ...rest }
    }
    static filterForReport(config: Configuration): ConfigurationReport {
        let { cropping, microphone } = config
        // Normalize values to reduce cardinality
        const videoFormat = VideoFormat.toReport(config.videoFormat, config.microphone.enabled)
        if (!cropping.enabled) {
            const { region: _, ...rest } = cropping
            cropping = { region: { x: 0, y: 0, width: 0, height: 0 }, ...rest }
        }
        if (!microphone.enabled) {
            const { gain: _, ...rest } = microphone
            microphone = { gain: 0, ...rest }
        }
        const recordingTimer: RecordingTimerReport = { ...config.recordingTimer }
        if (!config.recordingTimer.enabled) {
            recordingTimer.durationMinutes = undefined
            recordingTimer.skipStopConfirmation = undefined
        }
        const {
            windowSize,
            screenRecordingSize,
            openOptionPage,
            muteRecordingTab,
            recordingSortOrder,
            audioSeparation,
            uiTheme,
        } = config
        return {
            windowSize,
            screenRecordingSize,
            videoFormat,
            openOptionPage,
            muteRecordingTab,
            microphone: { enabled: microphone.enabled, gain: microphone.gain },
            cropping: {
                enabled: cropping.enabled,
                region: { width: cropping.region.width, height: cropping.region.height },
            },
            recordingSortOrder,
            audioSeparation,
            recordingTimer,
            uiTheme,
        }
    }
    static screenRecordingSize(screenRecordingSize: ScreenRecordingSize, base: Resolution): Resolution {
        if (screenRecordingSize.auto && base.width > 0 && base.height > 0) {
            return {
                width: base.width * screenRecordingSize.scale,
                height: base.height * screenRecordingSize.scale,
            }
        }
        return screenRecordingSize
    }
    static videoFormat(videoFormat: VideoFormat): VideoFormat {
        return videoFormat
    }
    /**
     * Apply migration logic to a merged configuration.
     * @param config - merged configuration (deepMerge of default + stored)
     * @param stored - raw stored configuration (may contain legacy fields)
     * @returns true if any migration was applied and the config should be persisted
     */
    static migrate(config: Configuration, stored: Record<string, unknown> | null): boolean {
        const defaultConfig = new Configuration()
        let migrated = false

        // Migrate legacy mimeType string to container/codec fields
        const storedVideoFormat = (stored as { videoFormat?: { mimeType?: string; container?: string } } | null)
            ?.videoFormat
        if (
            storedVideoFormat &&
            'mimeType' in storedVideoFormat &&
            storedVideoFormat.mimeType &&
            !storedVideoFormat.container
        ) {
            const m = migrateFromMimeType(storedVideoFormat.mimeType)
            config.videoFormat.container = m.container
            config.videoFormat.videoCodec = m.videoCodec
            config.videoFormat.audioCodec = m.audioCodec
            // Keep legacy mimeType field for backward compatibility with older extension versions
            migrated = true
        }

        // Migrate: if custom videoBitrate is 0 (legacy auto), switch to High preset
        if (config.videoFormat.videoBitrate === 0) {
            config.videoFormat.videoBitratePreset = 'high'
            config.videoFormat.videoBitrate = defaultConfig.videoFormat.videoBitrate
            migrated = true
        }

        // Migrate: existing users without uiTheme get 'classic'
        if (stored != null && !('uiTheme' in stored)) {
            config.uiTheme = 'classic'
            migrated = true
        }

        return migrated
    }

    static filename(startAtMs: number, ext: string) {
        return `video-${startAtMs}${ext}`
    }
    static audioFilename(startAtMs: number, suffix: 'tab' | 'mic', ext: string) {
        return `video-${startAtMs}-${suffix}${ext}`
    }
}
