vi.mock('mediabunny', async importOriginal => {
    const actual = await importOriginal<typeof import('mediabunny')>()
    return {
        ...actual,
        canEncodeAudio: vi.fn().mockResolvedValue(true),
    }
})
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import {
    migrateFromMimeType,
    VideoFormat,
    Configuration,
    audioSeparationContainer,
    isUITheme,
    resolveBitrate,
    type RecordingTimerReport,
} from '../src/configuration'
import { Quality } from 'mediabunny'
import { DEFAULT_SUMMARY_PROMPT } from '../src/summary/prompt'

describe('migrateFromMimeType', () => {
    describe('WebM container', () => {
        it('should default to vp9/opus when no codecs specified for webm', () => {
            const result = migrateFromMimeType('video/webm')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })
        })

        it('should detect webm container with vp8 video codec only specified', () => {
            const result = migrateFromMimeType('video/webm;codecs="vp8"')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp8', audioCodec: 'opus' })
        })

        it('should detect webm container with vp9 and opus', () => {
            const result = migrateFromMimeType('video/webm;codecs="vp9,opus"')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })
        })

        it('should detect webm container with vp8 and opus', () => {
            const result = migrateFromMimeType('video/webm;codecs="vp8,opus"')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp8', audioCodec: 'opus' })
        })

        it('should detect webm container with av1', () => {
            const result = migrateFromMimeType('video/webm;codecs="av01.0.04M.08,opus"')
            expect(result).toEqual({ container: 'webm', videoCodec: 'av1', audioCodec: 'opus' })
        })
    })

    describe('MP4 container', () => {
        it('should default to avc/aac when no codecs specified for mp4', () => {
            const result = migrateFromMimeType('video/mp4')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' })
        })

        it('should detect mp4 container with vp8 video codec only specified', () => {
            const result = migrateFromMimeType('video/mp4;codecs="vp8"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'vp8', audioCodec: 'aac' })
        })

        it('should detect mp4 container with avc and aac', () => {
            const result = migrateFromMimeType('video/mp4;codecs="avc1.42E01E,mp4a.40.2"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' })
        })

        it('should detect mp4 container with h264 and aac', () => {
            const result = migrateFromMimeType('video/mp4;codecs="avc1.424028, mp4a.40.2"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' })
        })

        it('should detect mp4 container with hevc', () => {
            const result = migrateFromMimeType('video/mp4;codecs="hvc1.1.6.L93.B0,mp4a.40.2"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'hevc', audioCodec: 'aac' })
        })

        it('should detect mp4 container with hev prefix', () => {
            const result = migrateFromMimeType('video/mp4;codecs="hev1,mp4a.40.2"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'hevc', audioCodec: 'aac' })
        })

        it('should detect mp4 container with h265', () => {
            const result = migrateFromMimeType('video/mp4;codecs="h265,aac"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'hevc', audioCodec: 'aac' })
        })

        it('should detect mp4 container with flac audio codec', () => {
            const result = migrateFromMimeType('video/mp4;codecs="avc1.424028,flac"')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'flac' })
        })
    })

    describe('edge cases', () => {
        it('should handle codecs without quotes', () => {
            const result = migrateFromMimeType('video/webm;codecs=vp8,opus')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp8', audioCodec: 'opus' })
        })

        it('should handle codecs broken quotes', () => {
            const result = migrateFromMimeType('video/mp4; codecs="avc1.42E01E, mp4a.40.2')
            expect(result).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' })
        })

        it('should handle extra parameters after codecs', () => {
            const result = migrateFromMimeType('video/webm;codecs="vp9,opus";foo=bar')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })
        })

        it('should handle codecs with spaces', () => {
            const result = migrateFromMimeType('video/webm; codecs="vp9, opus"')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })
        })

        it('should treat unknown base type as webm', () => {
            const result = migrateFromMimeType('video/x-matroska;codecs="vp9,opus"')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })
        })

        it('should handle empty', () => {
            const result = migrateFromMimeType('')
            expect(result).toEqual({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })
        })
    })
})

describe('VideoFormat.toReport', () => {
    const base: Omit<VideoFormat, 'recordingMode'> = {
        container: 'webm',
        audioCodec: 'opus',
        audioBitratePreset: 'high',
        audioBitrate: 256000,
        audioSampleRate: 44100,
        videoCodec: 'vp9',
        videoBitratePreset: 'high',
        videoBitrate: 8000000,
        frameRate: 30,
    }

    it('should include all fields for video-and-audio mode', () => {
        const vf: VideoFormat = {
            ...base,
            recordingMode: 'video-and-audio',
            audioBitratePreset: 'custom',
            videoBitratePreset: 'custom',
        }
        expect(VideoFormat.toReport(vf)).toEqual({
            recordingMode: 'video-and-audio',
            container: 'webm',
            audioCodec: 'opus',
            audioBitratePreset: 'custom',
            audioBitrate: 256000,
            audioSampleRate: 44100,
            videoCodec: 'vp9',
            videoBitratePreset: 'custom',
            videoBitrate: 8000000,
            frameRate: 30,
        })
    })

    it('should omit video fields for audio-only mode', () => {
        const vf: VideoFormat = { ...base, recordingMode: 'audio-only' }
        expect(VideoFormat.toReport(vf)).toEqual({
            recordingMode: 'audio-only',
            container: 'webm',
            audioCodec: 'opus',
            audioBitratePreset: 'high',
            audioBitrate: undefined,
            audioSampleRate: 44100,
            videoCodec: undefined,
            videoBitratePreset: undefined,
            videoBitrate: undefined,
            frameRate: undefined,
        })
    })

    it('should omit audio fields for video-only mode', () => {
        const vf: VideoFormat = { ...base, recordingMode: 'video-only' }
        expect(VideoFormat.toReport(vf)).toEqual({
            recordingMode: 'video-only',
            container: 'webm',
            audioCodec: undefined,
            audioBitratePreset: undefined,
            audioBitrate: undefined,
            audioSampleRate: undefined,
            videoCodec: 'vp9',
            videoBitratePreset: 'high',
            videoBitrate: undefined,
            frameRate: 30,
        })
    })

    it('should include audio fields for video-only mode with microphone enabled', () => {
        const vf: VideoFormat = { ...base, recordingMode: 'video-only' }
        expect(VideoFormat.toReport(vf, true)).toEqual({
            recordingMode: 'video-only',
            container: 'webm',
            audioCodec: 'opus',
            audioBitratePreset: 'high',
            audioBitrate: undefined,
            audioSampleRate: 44100,
            videoCodec: 'vp9',
            videoBitratePreset: 'high',
            videoBitrate: undefined,
            frameRate: 30,
        })
    })

    it('should include custom audioBitrate when preset is custom', () => {
        const vf: VideoFormat = {
            ...base,
            recordingMode: 'video-and-audio',
            audioBitratePreset: 'custom',
            audioBitrate: 128000,
        }
        expect(VideoFormat.toReport(vf)).toEqual({
            recordingMode: 'video-and-audio',
            container: 'webm',
            audioCodec: 'opus',
            audioBitratePreset: 'custom',
            audioBitrate: 128000,
            audioSampleRate: 44100,
            videoCodec: 'vp9',
            videoBitratePreset: 'high',
            videoBitrate: undefined,
            frameRate: 30,
        })
    })

    it('should include custom videoBitrate when preset is custom', () => {
        const vf: VideoFormat = {
            ...base,
            recordingMode: 'video-and-audio',
            videoBitratePreset: 'custom',
            videoBitrate: 4000000,
        }
        expect(VideoFormat.toReport(vf)).toEqual({
            recordingMode: 'video-and-audio',
            container: 'webm',
            audioCodec: 'opus',
            audioBitratePreset: 'high',
            audioBitrate: undefined,
            audioSampleRate: 44100,
            videoCodec: 'vp9',
            videoBitratePreset: 'custom',
            videoBitrate: 4000000,
            frameRate: 30,
        })
    })
})

describe('Configuration.audioFilename', () => {
    it('should generate tab audio filename', () => {
        expect(Configuration.audioFilename(1704067200000, 'tab', '.ogg')).toBe('video-1704067200000-tab.ogg')
    })

    it('should generate mic audio filename', () => {
        expect(Configuration.audioFilename(1704067200000, 'mic', '.aac')).toBe('video-1704067200000-mic.aac')
    })
})

describe('audioSeparationContainer', () => {
    it('should map opus to ogg', () => {
        expect(audioSeparationContainer('opus')).toBe('ogg')
    })

    it('should map aac to adts', () => {
        expect(audioSeparationContainer('aac')).toBe('adts')
    })

    it('should map flac to flac', () => {
        expect(audioSeparationContainer('flac')).toBe('flac')
    })

    it('should fallback to mp4 for unknown codec', () => {
        expect(audioSeparationContainer('unknown' as never)).toBe('mp4')
    })
})

describe('isUITheme', () => {
    it('should accept valid themes', () => {
        expect(isUITheme('classic')).toBe(true)
        expect(isUITheme('light')).toBe(true)
        expect(isUITheme('dark')).toBe(true)
        expect(isUITheme('auto')).toBe(true)
    })

    it('should reject invalid values', () => {
        expect(isUITheme('invalid')).toBe(false)
        expect(isUITheme('')).toBe(false)
        expect(isUITheme(null)).toBe(false)
        expect(isUITheme(undefined)).toBe(false)
        expect(isUITheme(42)).toBe(false)
    })
})

describe('Configuration.uiTheme', () => {
    it('should default to auto for new configurations', () => {
        const config = new Configuration()
        expect(config.uiTheme).toBe('auto')
    })

    it('should migrate existing users without uiTheme to classic', () => {
        const config = new Configuration()
        const stored = { videoFormat: { container: 'webm' } } as Record<string, unknown>
        const migrated = Configuration.migrate(config, stored)
        expect(migrated).toBe(true)
        expect(config.uiTheme).toBe('classic')
    })

    it('should not migrate when stored config has uiTheme', () => {
        const config = new Configuration()
        config.uiTheme = 'dark'
        const stored = { uiTheme: 'dark', videoFormat: { container: 'webm' } } as Record<string, unknown>
        const migrated = Configuration.migrate(config, stored)
        expect(migrated).toBe(false)
        expect(config.uiTheme).toBe('dark')
    })

    it('should not migrate when stored is null (new install)', () => {
        const config = new Configuration()
        const migrated = Configuration.migrate(config, null)
        expect(migrated).toBe(false)
        expect(config.uiTheme).toBe('auto')
    })

    it('should include uiTheme in filterForReport', () => {
        const config = new Configuration()
        config.uiTheme = 'dark'
        const report = Configuration.filterForReport(config)
        expect(report.uiTheme).toBe('dark')
    })

    it('should include uiTheme in filterForSync', () => {
        const config = new Configuration()
        config.uiTheme = 'light'
        const synced = Configuration.filterForSync(config)
        expect(synced.uiTheme).toBe('light')
    })
})

describe('Configuration.recordingTimer', () => {
    it('should default to disabled with 30 minutes and skipStopConfirmation false', () => {
        const config = new Configuration()
        expect(config.recordingTimer).toEqual({ enabled: false, durationMinutes: 30, skipStopConfirmation: false })
    })

    it('should include recordingTimer in filterForSync', () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: true, durationMinutes: 60, skipStopConfirmation: true }
        const synced = Configuration.filterForSync(config)
        expect(synced.recordingTimer).toEqual({ enabled: true, durationMinutes: 60, skipStopConfirmation: true })
    })

    it('should include durationMinutes in report when enabled', () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: true, durationMinutes: 45, skipStopConfirmation: false }
        const report = Configuration.filterForReport(config)
        expect(report.recordingTimer).toEqual({
            enabled: true,
            durationMinutes: 45,
            skipStopConfirmation: false,
        } satisfies RecordingTimerReport)
    })

    it('should omit durationMinutes, skipStopConfirmation in report when disabled', () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: false, durationMinutes: 45, skipStopConfirmation: true }
        const report = Configuration.filterForReport(config)
        expect(report.recordingTimer).toEqual({
            enabled: false,
            durationMinutes: undefined,
            skipStopConfirmation: undefined,
        } satisfies RecordingTimerReport)
        expect(report.recordingTimer.durationMinutes).toBeUndefined()
    })

    it('should reset recordingTimer on restoreDefault', () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: true, durationMinutes: 120, skipStopConfirmation: true }
        const restored = Configuration.restoreDefault(config)
        expect(restored.recordingTimer).toEqual({ enabled: false, durationMinutes: 30, skipStopConfirmation: false })
    })
})

describe('Configuration.hasAgreedTerms', () => {
    it('should default to false for new configurations', () => {
        const config = new Configuration()
        expect(config.hasAgreedTerms).toBe(false)
    })

    it('should include hasAgreedTerms in filterForSync', () => {
        const config = new Configuration()
        config.hasAgreedTerms = true
        const synced = Configuration.filterForSync(config)
        expect(synced.hasAgreedTerms).toBe(true)
    })

    it('should preserve hasAgreedTerms on restoreDefault', () => {
        const config = new Configuration()
        config.hasAgreedTerms = true
        const restored = Configuration.restoreDefault(config)
        expect(restored.hasAgreedTerms).toBe(true)
    })
})

describe('Configuration.transcription', () => {
    const originalChrome = globalThis.chrome

    afterEach(() => {
        Object.defineProperty(globalThis, 'chrome', {
            value: originalChrome,
            writable: true,
            configurable: true,
        })
    })

    it('should default language to japanese when browser language is ja', () => {
        ;(globalThis as Record<string, unknown>).chrome = {
            i18n: {
                getMessage: () => '',
                getUILanguage: () => 'ja',
            },
        }
        const config = new Configuration()
        expect(config.transcription).toEqual({
            enabled: false,
            language: 'japanese',
        })
    })

    it('should default language to english when browser language is en', () => {
        ;(globalThis as Record<string, unknown>).chrome = {
            i18n: {
                getMessage: () => '',
                getUILanguage: () => 'en-US',
            },
        }
        const config = new Configuration()
        expect(config.transcription).toEqual({
            enabled: false,
            language: 'english',
        })
    })

    it('should include transcription in filterForReport', () => {
        const config = new Configuration()
        config.transcription = { enabled: true, language: 'french' }
        const report = Configuration.filterForReport(config)
        expect(report.transcription).toEqual({ enabled: true, language: 'french' })
    })

    it('should exclude transcription from filterForSync', () => {
        const config = new Configuration()
        config.transcription = { enabled: true, language: 'german' }
        const synced = Configuration.filterForSync(config)
        expect('transcription' in synced).toBe(false)
    })

    it('should reset transcription on restoreDefault with browser language', () => {
        ;(globalThis as Record<string, unknown>).chrome = {
            i18n: {
                getMessage: () => '',
                getUILanguage: () => 'ja',
            },
        }
        const config = new Configuration()
        config.transcription = { enabled: true, language: 'french' }
        const restored = Configuration.restoreDefault(config)
        expect(restored.transcription).toEqual({
            enabled: false,
            language: 'japanese',
        })
    })

    it('should include summary in filterForReport', () => {
        const config = new Configuration()
        config.summary = { enabled: true, prompt: 'custom prompt' }
        const report = Configuration.filterForReport(config)
        expect(report.summary).toEqual({ enabled: true })
    })

    it('should exclude summary from filterForSync', () => {
        const config = new Configuration()
        config.summary = { enabled: true, prompt: 'custom prompt' }
        const synced = Configuration.filterForSync(config)
        expect('summary' in synced).toBe(false)
    })

    it('should reset summary on restoreDefault', () => {
        const config = new Configuration()
        config.summary = { enabled: true, prompt: 'custom prompt' }
        const restored = Configuration.restoreDefault(config)
        expect(restored.summary).toEqual({ enabled: false, prompt: DEFAULT_SUMMARY_PROMPT })
    })

    it('should migrate legacy summary config without prompt to include default prompt', () => {
        const config = new Configuration()
        ;(config.summary as any).prompt = undefined
        const migrated = Configuration.migrate(config, { summary: { enabled: true } })
        expect(migrated).toBe(true)
        expect(config.summary.prompt).toBe(DEFAULT_SUMMARY_PROMPT)
    })
})

describe('resolveBitrate', () => {
    test.each([
        { preset: 'very-high', customValue: 5_000_000, expected: new Quality('very-high') },
        { preset: 'high', customValue: 5_000_000, expected: new Quality('high') },
        { preset: 'medium', customValue: 5_000_000, expected: new Quality('medium') },
        { preset: 'low', customValue: 5_000_000, expected: new Quality('low') },
        { preset: 'very-low', customValue: 5_000_000, expected: new Quality('very-low') },
        { preset: 'custom', customValue: 2_500_000, expected: 2_500_000 },
    ] as const)('resolves bitrate for preset "$preset"', ({ preset, customValue, expected }) => {
        const result = resolveBitrate(preset, customValue)
        if (typeof expected === 'number') {
            expect(result).toBe(expected)
        } else {
            expect(result).toBeInstanceOf(Quality)
            expect(result).toEqual(expected)
        }
    })
})
