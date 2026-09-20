vi.mock('mediabunny', () => {
    const mockOutput = {
        addVideoTrack: vi.fn(),
        addAudioTrack: vi.fn(),
    }
    return {
        Output: vi.fn(function () {
            return mockOutput
        }),
        StreamTarget: vi.fn(function () {}),
        MediaStreamVideoTrackSource: vi.fn(function () {
            return { errorPromise: Promise.resolve(), pause: vi.fn(), resume: vi.fn() }
        }),
        MediaStreamAudioTrackSource: vi.fn(function () {
            return { errorPromise: Promise.resolve(), pause: vi.fn(), resume: vi.fn() }
        }),
        canEncodeAudio: vi.fn().mockResolvedValue(true),
        WebMOutputFormat: vi.fn(function () {}),
        Mp4OutputFormat: vi.fn(function () {}),
        OggOutputFormat: vi.fn(function () {}),
        AdtsOutputFormat: vi.fn(function () {}),
        FlacOutputFormat: vi.fn(function () {}),
        QUALITY_HIGH: 'high',
        QUALITY_MEDIUM: 'medium',
        QUALITY_LOW: 'low',
        Quality: class Quality {
            constructor(public value: string) {}
        },
    }
})
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import { Output, MediaStreamVideoTrackSource, MediaStreamAudioTrackSource } from 'mediabunny'
import { OutputManager } from '../../src/recorder/output_manager'
import { VideoFormat } from '../../src/configuration'

// ---------- helpers ----------

function createMockTrack(kind: 'audio' | 'video'): MediaStreamTrack {
    return { kind, id: kind, stop: vi.fn() } as unknown as MediaStreamTrack
}

function createMockStream(audioTracks: MediaStreamTrack[] = [], videoTracks: MediaStreamTrack[] = []): MediaStream {
    return {
        getAudioTracks: vi.fn(() => audioTracks),
        getVideoTracks: vi.fn(() => videoTracks),
        getTracks: vi.fn(() => [...audioTracks, ...videoTracks]),
    } as unknown as MediaStream
}

function createVideoFormat(overrides: Partial<VideoFormat> = {}): VideoFormat {
    return new VideoFormat(
        overrides.recordingMode ?? 'video-and-audio',
        overrides.container ?? 'webm',
        overrides.audioCodec ?? 'opus',
        overrides.audioBitratePreset ?? 'high',
        overrides.audioBitrate ?? 256000,
        overrides.audioSampleRate ?? 44100,
        overrides.videoCodec ?? 'vp9',
        overrides.videoBitratePreset ?? 'high',
        overrides.videoBitrate ?? 8000000,
        overrides.frameRate ?? 30,
    )
}

// ---------- OutputManager ----------

describe('OutputManager', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('createOutput', () => {
        test('creates an Output for webm container', () => {
            const manager = new OutputManager()
            const writable = {} as WritableStream

            const output = manager.createOutput(writable, 'webm')
            expect(output).toBeDefined()
            expect(Output).toHaveBeenCalled()
        })

        test('creates an Output for mp4 container', () => {
            const manager = new OutputManager()
            const writable = {} as WritableStream

            const output = manager.createOutput(writable, 'mp4')
            expect(output).toBeDefined()
        })
    })

    describe('addTracks', () => {
        test('adds both video and audio tracks for video-and-audio mode', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const videoTrack = createMockTrack('video')
            const audioTrack = createMockTrack('audio')
            const media = createMockStream([audioTrack], [videoTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'video-and-audio' })

            const { sources, errorPromises } = manager.addTracks(output, media, videoFormat, true)

            expect(MediaStreamVideoTrackSource).toHaveBeenCalledWith(
                videoTrack,
                expect.objectContaining({
                    codec: 'vp9',
                    sizeChangeBehavior: 'passThrough',
                }),
            )
            expect(MediaStreamAudioTrackSource).toHaveBeenCalledWith(
                audioTrack,
                expect.objectContaining({
                    codec: 'opus',
                }),
            )
            expect(output.addVideoTrack).toHaveBeenCalled()
            expect(output.addAudioTrack).toHaveBeenCalled()
            expect(sources).toHaveLength(2)
            expect(errorPromises).toHaveLength(2)
        })

        test('adds only video track for video-only mode without audio', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const videoTrack = createMockTrack('video')
            const media = createMockStream([], [videoTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'video-only' })

            const { sources, errorPromises } = manager.addTracks(output, media, videoFormat, false)

            expect(MediaStreamVideoTrackSource).toHaveBeenCalledWith(videoTrack, expect.any(Object))
            expect(output.addVideoTrack).toHaveBeenCalled()
            expect(output.addAudioTrack).not.toHaveBeenCalled()
            expect(sources).toHaveLength(1)
            expect(errorPromises).toHaveLength(1)
        })

        test('adds only audio track for audio-only mode', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'ogg')
            const audioTrack = createMockTrack('audio')
            const media = createMockStream([audioTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'audio-only', container: 'ogg' })

            const { sources, errorPromises } = manager.addTracks(output, media, videoFormat, true)

            expect(MediaStreamVideoTrackSource).not.toHaveBeenCalled()
            expect(output.addVideoTrack).not.toHaveBeenCalled()
            expect(MediaStreamAudioTrackSource).toHaveBeenCalledWith(audioTrack, expect.any(Object))
            expect(output.addAudioTrack).toHaveBeenCalled()
            expect(sources).toHaveLength(1)
            expect(errorPromises).toHaveLength(1)
        })

        test('adds video + audio for video-only mode with mic (hasAudioTrack=true)', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const videoTrack = createMockTrack('video')
            const audioTrack = createMockTrack('audio')
            const media = createMockStream([audioTrack], [videoTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'video-only' })

            const { sources, errorPromises } = manager.addTracks(output, media, videoFormat, true)

            expect(output.addVideoTrack).toHaveBeenCalled()
            expect(output.addAudioTrack).toHaveBeenCalled()
            expect(sources).toHaveLength(2)
            expect(errorPromises).toHaveLength(2)
        })

        test('handles missing tracks gracefully', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const media = createMockStream() // no tracks
            const videoFormat = createVideoFormat({ recordingMode: 'video-and-audio' })

            const { sources, errorPromises } = manager.addTracks(output, media, videoFormat, true)

            expect(output.addVideoTrack).not.toHaveBeenCalled()
            expect(output.addAudioTrack).not.toHaveBeenCalled()
            expect(sources).toHaveLength(0)
            expect(errorPromises).toHaveLength(0)
        })
    })

    describe('createAudioTrackOutput', () => {
        test('creates output with audio track', () => {
            const manager = new OutputManager()
            const writable = {} as WritableStream
            const audioTrack = createMockTrack('audio') as unknown as MediaStreamAudioTrack

            const handle = manager.createAudioTrackOutput(writable, audioTrack, 'ogg', 'opus', 'high', 256000)

            expect(handle.output).toBeDefined()
            expect(handle.sources).toHaveLength(1)
            expect(handle.errorPromises).toHaveLength(1)
            expect(MediaStreamAudioTrackSource).toHaveBeenCalledWith(
                audioTrack,
                expect.objectContaining({
                    codec: 'opus',
                }),
            )
        })
    })
})
