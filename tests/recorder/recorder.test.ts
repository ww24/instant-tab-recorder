import type { Mock } from 'vitest'

vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))
vi.mock('../../src/sentry', () => ({
    sendException: vi.fn(),
}))

import { RecordingSession } from '../../src/recorder/recorder'
import type { RecordingConfig, RecorderCallbacks } from '../../src/recorder/recorder'
import type { AudioMixer } from '../../src/recorder/audio_mixer'
import type { MediaCapture } from '../../src/recorder/media_capture'
import type { OutputManager } from '../../src/recorder/output_manager'
import type { AudioSeparationManager, AudioSeparationOutputs } from '../../src/recorder/audio_separation'
import type { FileManager } from '../../src/recorder/file_manager'
import type { Preview } from '../../src/preview'
import type { Crop } from '../../src/crop'
import type { StartRecording } from '../../src/message'
import { VideoFormat } from '../../src/configuration'

// ---------- mock factories ----------

function createMockTrack(kind: 'audio' | 'video', id = '1'): MediaStreamTrack {
    const listeners = new Map<string, EventListener[]>()
    return {
        kind,
        id,
        stop: vi.fn(),
        clone: vi.fn(() => createMockTrack(kind, `${id}-clone`)),
        addEventListener: vi.fn((event: string, listener: EventListener) => {
            if (!listeners.has(event)) listeners.set(event, [])
            listeners.get(event)!.push(listener)
        }),
        dispatchEvent: vi.fn((event: Event) => {
            listeners.get(event.type)?.forEach(l => l(event))
            return true
        }),
    } as unknown as MediaStreamTrack
}

function createMockStream(audioTracks: MediaStreamTrack[] = [], videoTracks: MediaStreamTrack[] = []): MediaStream {
    return {
        getAudioTracks: vi.fn(() => audioTracks),
        getVideoTracks: vi.fn(() => videoTracks),
        getTracks: vi.fn(() => [...videoTracks, ...audioTracks]),
    } as unknown as MediaStream
}

function createMockOutput(state: string = 'idle') {
    return {
        state,
        start: vi.fn().mockResolvedValue(undefined),
        finalize: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
        addVideoTrack: vi.fn(),
        addAudioTrack: vi.fn(),
    }
}

function createMockMediaCapture(): MediaCapture {
    const tabStream = createMockStream([createMockTrack('audio', 'tab-audio')], [createMockTrack('video', 'tab-video')])
    const micStream = createMockStream([createMockTrack('audio', 'mic-audio')])
    return {
        captureTab: vi.fn().mockResolvedValue(tabStream),
        captureMicrophone: vi.fn().mockResolvedValue(micStream),
    } as unknown as MediaCapture
}

function createMockAudioMixer(): AudioMixer {
    return {
        mix: vi.fn((tabStream: MediaStream) => tabStream),
        setupPlayback: vi.fn(),
    } as unknown as AudioMixer
}

function createMockOutputManager(): OutputManager {
    const mockOutput = createMockOutput()
    return {
        createOutput: vi.fn(() => mockOutput),
        addTracks: vi.fn(() => ({ sources: [], errorPromises: [] })),
        createAudioTrackOutput: vi.fn(() => ({
            output: createMockOutput(),
            sources: [],
            errorPromises: [],
        })),
        _mockOutput: mockOutput,
    } as unknown as OutputManager & { _mockOutput: ReturnType<typeof createMockOutput> }
}

function createMockAudioSeparation(): AudioSeparationManager {
    const outputs: AudioSeparationOutputs = {
        sources: [],
        clonedTracks: [],
        errorPromises: [],
    }
    return {
        createOutputs: vi.fn().mockResolvedValue(outputs),
        finalizeAll: vi.fn().mockResolvedValue(undefined),
        cancelAll: vi.fn().mockResolvedValue(undefined),
        getSubFileInfos: vi.fn().mockResolvedValue([]),
    } as unknown as AudioSeparationManager
}

function createMockFileManager(): FileManager {
    const mockFileHandle = {
        name: 'video-123.webm',
        getFile: vi.fn().mockResolvedValue(new File(['data'], 'video-123.webm', { type: 'video/webm' })),
        createWritable: vi.fn().mockResolvedValue({}),
    }
    return {
        createRecordingFile: vi.fn().mockResolvedValue(mockFileHandle),
        createAudioFile: vi.fn().mockResolvedValue(mockFileHandle),
    } as unknown as FileManager
}

function createMockPreview(): Preview {
    return {
        start: vi.fn(),
        stop: vi.fn(),
    } as unknown as Preview
}

function createMockCrop(): Crop {
    return {
        region: { x: 0, y: 0, width: 1, height: 1 },
        getCroppedStream: vi.fn((stream: MediaStream) => stream),
    } as unknown as Crop
}

function createMockCallbacks(): RecorderCallbacks & {
    onTabTrackEnded: Mock
    onSourceError: Mock
    onTick: Mock
} {
    return {
        onTabTrackEnded: vi.fn().mockResolvedValue(undefined),
        onSourceError: vi.fn().mockResolvedValue(undefined),
        onTick: vi.fn().mockResolvedValue(undefined),
    }
}

function createDefaultConfig(overrides: Partial<RecordingConfig> = {}): RecordingConfig {
    return {
        videoFormat: new VideoFormat(
            'video-and-audio',
            'webm',
            'opus',
            'high',
            256000,
            44100,
            'vp9',
            'high',
            8000000,
            30,
        ),
        recordingSize: { width: 1920, height: 1080 },
        microphone: { enabled: true, gain: 1.0, deviceId: null },
        cropping: { enabled: false, region: { x: 0, y: 0, width: 1920, height: 1080 } },
        muteRecordingTab: false,
        audioSeparation: { enabled: false },
        ...overrides,
    }
}

const defaultRequest: StartRecording = {
    tabSize: { width: 1920, height: 1080 },
    streamId: 'stream-123',
}

// ---------- tests ----------

describe('RecordingSession', () => {
    let mediaCapture: ReturnType<typeof createMockMediaCapture>
    let audioMixer: ReturnType<typeof createMockAudioMixer>
    let outputManager: ReturnType<typeof createMockOutputManager>
    let audioSeparation: ReturnType<typeof createMockAudioSeparation>
    let fileManager: ReturnType<typeof createMockFileManager>
    let preview: ReturnType<typeof createMockPreview>
    let crop: ReturnType<typeof createMockCrop>
    let callbacks: ReturnType<typeof createMockCallbacks>
    let session: RecordingSession

    beforeEach(() => {
        vi.useFakeTimers()
        mediaCapture = createMockMediaCapture()
        audioMixer = createMockAudioMixer()
        outputManager = createMockOutputManager()
        audioSeparation = createMockAudioSeparation()
        fileManager = createMockFileManager()
        preview = createMockPreview()
        crop = createMockCrop()
        callbacks = createMockCallbacks()

        session = new RecordingSession(
            mediaCapture,
            audioMixer,
            outputManager,
            audioSeparation,
            fileManager,
            preview,
            crop,
            callbacks,
        )
    })

    afterEach(async () => {
        await session.cancel()
        vi.useRealTimers()
    })

    describe('start', () => {
        test('starts recording and returns response', async () => {
            const config = createDefaultConfig()
            const response = await session.start(defaultRequest, config)

            expect(response.startAtMs).toBeGreaterThan(0)
            expect(response.mainFilePath).toBe('video-123.webm')
            expect(response.mimeType).toBe('video/webm')
            expect(response.recordingMode).toBe('video-and-audio')
            expect(response.micEnabled).toBe(true)
            expect(session.state).toBe('recording')
        })

        test('captures tab and microphone', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            expect(mediaCapture.captureTab).toHaveBeenCalledWith(
                'stream-123',
                { width: 1920, height: 1080 },
                30,
                'video-and-audio',
                44100,
            )
            expect(mediaCapture.captureMicrophone).toHaveBeenCalledWith(config.microphone, 44100)
        })

        test('mixes audio streams', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            expect(audioMixer.mix).toHaveBeenCalled()
        })

        test('sets up playback when not muted and has audio tracks', async () => {
            const config = createDefaultConfig({ muteRecordingTab: false })
            await session.start(defaultRequest, config)

            expect(audioMixer.setupPlayback).toHaveBeenCalled()
        })

        test('does not set up playback when muted', async () => {
            const config = createDefaultConfig({ muteRecordingTab: true })
            await session.start(defaultRequest, config)

            expect(audioMixer.setupPlayback).not.toHaveBeenCalled()
        })

        test('applies cropping when enabled and has video', async () => {
            const config = createDefaultConfig({
                cropping: { enabled: true, region: { x: 10, y: 20, width: 100, height: 200 } },
            })
            await session.start(defaultRequest, config)

            expect(crop.getCroppedStream).toHaveBeenCalled()
        })

        test('does not apply cropping for audio-only mode', async () => {
            const config = createDefaultConfig({
                videoFormat: new VideoFormat(
                    'audio-only',
                    'ogg',
                    'opus',
                    'high',
                    256000,
                    44100,
                    'vp9',
                    'high',
                    8000000,
                    30,
                ),
                cropping: { enabled: true, region: { x: 10, y: 20, width: 100, height: 200 } },
            })
            await session.start(defaultRequest, config)

            expect(crop.getCroppedStream).not.toHaveBeenCalled()
        })

        test('creates audio separation outputs when enabled', async () => {
            const config = createDefaultConfig({ audioSeparation: { enabled: true } })
            await session.start(defaultRequest, config)

            expect(audioSeparation.createOutputs).toHaveBeenCalled()
        })

        test('does not create audio separation when disabled', async () => {
            const config = createDefaultConfig({ audioSeparation: { enabled: false } })
            await session.start(defaultRequest, config)

            expect(audioSeparation.createOutputs).not.toHaveBeenCalled()
        })

        test('throws if already recording', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            await expect(session.start(defaultRequest, config)).rejects.toThrow(
                'Called startRecording while recording is in progress.',
            )
        })

        test('throws if start is called while starting', async () => {
            const config = createDefaultConfig()
            // Make captureTab hang so session stays in 'starting' state
            let resolveCapture!: (value: MediaStream) => void
            ;(mediaCapture.captureTab as Mock).mockReturnValue(
                new Promise<MediaStream>(resolve => {
                    resolveCapture = resolve
                }),
            )

            const startPromise = session.start(defaultRequest, config)
            expect(session.state).toBe('starting')

            await expect(session.start(defaultRequest, config)).rejects.toThrow(
                'Called startRecording while recording is in progress.',
            )

            // Resolve the hanging capture to let the first start complete
            const tabStream = createMockStream(
                [createMockTrack('audio', 'tab-audio')],
                [createMockTrack('video', 'tab-video')],
            )
            resolveCapture(tabStream)
            await startPromise
        })

        test('cleans up on error during start', async () => {
            ;(mediaCapture.captureTab as Mock).mockRejectedValue(new Error('capture failed'))
            const config = createDefaultConfig()

            await expect(session.start(defaultRequest, config)).rejects.toThrow('capture failed')
            expect(session.state).toBe('idle')
        })

        test('micEnabled is false when mic capture returns null', async () => {
            ;(mediaCapture.captureMicrophone as Mock).mockResolvedValue(null)
            const config = createDefaultConfig()
            const response = await session.start(defaultRequest, config)

            expect(response.micEnabled).toBe(false)
        })

        test('starts periodic tick timer', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            // Advance timer to trigger tick
            vi.advanceTimersByTime(60_000)

            // Wait for the async tick callback to resolve
            await Promise.resolve()

            expect(callbacks.onTick).toHaveBeenCalled()
        })
    })

    describe('stop', () => {
        test('stops recording and returns result', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            // Patch output state to 'started'
            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            mockOutput.state = 'started'

            const result = await session.stop()

            expect(result).not.toBeNull()
            expect(result!.durationMs).toBeGreaterThanOrEqual(0)
            expect(result!.fileSize).toBeGreaterThanOrEqual(0)
            expect(session.state).toBe('idle')
        })

        test('stops preview on stop', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            mockOutput.state = 'started'

            await session.stop()
            expect(preview.stop).toHaveBeenCalled()
        })

        test('finalizes audio separation outputs on stop', async () => {
            const config = createDefaultConfig({ audioSeparation: { enabled: true } })
            await session.start(defaultRequest, config)

            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            mockOutput.state = 'started'

            await session.stop()
            expect(audioSeparation.finalizeAll).toHaveBeenCalled()
        })

        test('returns null when no output exists', async () => {
            const result = await session.stop()
            expect(result).toBeNull()
        })

        test('returns null when output not started', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            // Output state is 'idle' by default (not 'started')
            const result = await session.stop()
            expect(result).toBeNull()
        })

        test('stops media tracks on stop', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            mockOutput.state = 'started'

            await session.stop()

            // Media tracks should be stopped
            const tabStream = await (mediaCapture.captureTab as Mock).mock.results[0].value
            tabStream.getTracks().forEach((track: MediaStreamTrack) => {
                expect(track.stop).toHaveBeenCalled()
            })
        })
    })

    describe('cancel', () => {
        test('cancels recording and returns duration', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            const durationMs = await session.cancel()

            expect(durationMs).toBeGreaterThanOrEqual(0)
            expect(session.state).toBe('idle')
        })

        test('cancels audio separation outputs', async () => {
            const config = createDefaultConfig({ audioSeparation: { enabled: true } })
            await session.start(defaultRequest, config)

            await session.cancel()
            expect(audioSeparation.cancelAll).toHaveBeenCalled()
        })

        test('stops preview on cancel', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            await session.cancel()
            expect(preview.stop).toHaveBeenCalled()
        })

        test('returns 0 when called without starting', async () => {
            const durationMs = await session.cancel()
            expect(durationMs).toBe(0)
        })

        test('throws when main output cancel fails', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            const cancelError = new Error('Main output cancel failed')
            ;(mockOutput.cancel as Mock).mockRejectedValue(cancelError)

            let caughtError: unknown
            try {
                await session.cancel()
            } catch (e) {
                caughtError = e
            }

            expect(caughtError).toBeDefined()
            expect((caughtError as Error).message).toContain('Main output cancel error')
            expect(session.state).toBe('idle')
        })

        test('throws when audio separation cancel fails', async () => {
            const config = createDefaultConfig({ audioSeparation: { enabled: true } })
            await session.start(defaultRequest, config)

            const separationError = new Error('Audio separation cancel failed')
            ;(audioSeparation.cancelAll as Mock).mockRejectedValue(separationError)

            let caughtError: unknown
            try {
                await session.cancel()
            } catch (e) {
                caughtError = e
            }

            expect(caughtError).toBeDefined()
            expect((caughtError as Error).message).toContain('Audio separation cancel error')
            expect(session.state).toBe('idle')
        })

        test('throws AggregateError when both main output and audio separation cancel fail', async () => {
            const config = createDefaultConfig({ audioSeparation: { enabled: true } })
            await session.start(defaultRequest, config)

            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            const mainError = new Error('Main output cancel failed')
            const sepError = new Error('Audio separation cancel failed')
            ;(mockOutput.cancel as Mock).mockRejectedValue(mainError)
            ;(audioSeparation.cancelAll as Mock).mockRejectedValue(sepError)

            let caughtError: unknown
            try {
                await session.cancel()
            } catch (e) {
                caughtError = e
            }

            expect(caughtError).toBeInstanceOf(AggregateError)
            expect((caughtError as AggregateError).errors).toHaveLength(2)
            expect(session.state).toBe('idle')
        })
    })

    describe('pause and resume', () => {
        test('pause transitions to paused state', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)
            expect(session.state).toBe('recording')

            session.pause()
            expect(session.state).toBe('paused')
            expect(session.isPaused).toBe(true)
        })

        test('resume transitions back to recording state', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            session.pause()
            session.resume()
            expect(session.state).toBe('recording')
            expect(session.isPaused).toBe(false)
        })

        test('pause throws if not recording', () => {
            expect(() => session.pause()).toThrow("Cannot pause in state 'idle'")
        })

        test('resume throws if not paused', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            expect(() => session.resume()).toThrow("Cannot resume in state 'recording'")
        })

        test('double pause throws', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            session.pause()
            expect(() => session.pause()).toThrow("Cannot pause in state 'paused'")
        })

        test('pause calls pause on all sources', async () => {
            const mockSource = { pause: vi.fn(), resume: vi.fn(), paused: false, errorPromise: Promise.resolve() }
            const om = {
                createOutput: vi.fn(() => createMockOutput()),
                addTracks: vi.fn(() => ({ sources: [mockSource], errorPromises: [] })),
                createAudioTrackOutput: vi.fn(() => ({ output: createMockOutput(), sources: [], errorPromises: [] })),
                _mockOutput: createMockOutput(),
            } as unknown as OutputManager & { _mockOutput: ReturnType<typeof createMockOutput> }

            const s = new RecordingSession(
                mediaCapture,
                audioMixer,
                om,
                audioSeparation,
                fileManager,
                preview,
                crop,
                callbacks,
            )
            const config = createDefaultConfig()
            await s.start(defaultRequest, config)

            s.pause()
            expect(mockSource.pause).toHaveBeenCalled()
        })

        test('resume calls resume on all sources', async () => {
            const mockSource = { pause: vi.fn(), resume: vi.fn(), paused: false, errorPromise: Promise.resolve() }
            const om = {
                createOutput: vi.fn(() => createMockOutput()),
                addTracks: vi.fn(() => ({ sources: [mockSource], errorPromises: [] })),
                createAudioTrackOutput: vi.fn(() => ({ output: createMockOutput(), sources: [], errorPromises: [] })),
                _mockOutput: createMockOutput(),
            } as unknown as OutputManager & { _mockOutput: ReturnType<typeof createMockOutput> }

            const s = new RecordingSession(
                mediaCapture,
                audioMixer,
                om,
                audioSeparation,
                fileManager,
                preview,
                crop,
                callbacks,
            )
            const config = createDefaultConfig()
            await s.start(defaultRequest, config)

            s.pause()
            s.resume()
            expect(mockSource.resume).toHaveBeenCalled()
        })

        test('stop from paused state resumes sources and finalizes', async () => {
            const mockSource = { pause: vi.fn(), resume: vi.fn(), paused: false, errorPromise: Promise.resolve() }
            const mockOutput = createMockOutput()
            const om = {
                createOutput: vi.fn(() => mockOutput),
                addTracks: vi.fn(() => ({ sources: [mockSource], errorPromises: [] })),
                createAudioTrackOutput: vi.fn(() => ({ output: createMockOutput(), sources: [], errorPromises: [] })),
                _mockOutput: mockOutput,
            } as unknown as OutputManager & { _mockOutput: ReturnType<typeof createMockOutput> }

            const s = new RecordingSession(
                mediaCapture,
                audioMixer,
                om,
                audioSeparation,
                fileManager,
                preview,
                crop,
                callbacks,
            )
            const config = createDefaultConfig()
            await s.start(defaultRequest, config)
            mockOutput.state = 'started'

            s.pause()
            const result = await s.stop()
            expect(mockSource.resume).toHaveBeenCalled()
            expect(result).not.toBeNull()
            expect(s.state).toBe('idle')
        })

        test('duration excludes paused time', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            const mockOutput = (outputManager as unknown as { _mockOutput: ReturnType<typeof createMockOutput> })
                ._mockOutput
            mockOutput.state = 'started'

            // Advance 10 seconds, pause, advance 5 seconds, resume, advance 10 seconds
            vi.advanceTimersByTime(10_000)
            session.pause()
            vi.advanceTimersByTime(5_000)
            session.resume()
            vi.advanceTimersByTime(10_000)

            const result = await session.stop()
            expect(result).not.toBeNull()
            // Total wall time: 25s, paused: 5s, so duration should be ~20s
            expect(result!.durationMs).toBe(20_000)
        })

        test('elapsedPausedMs tracks total paused time', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            expect(session.elapsedPausedMs).toBe(0)

            vi.advanceTimersByTime(1_000)
            session.pause()
            vi.advanceTimersByTime(3_000)
            session.resume()

            expect(session.elapsedPausedMs).toBe(3_000)

            vi.advanceTimersByTime(1_000)
            session.pause()
            vi.advanceTimersByTime(2_000)
            session.resume()

            expect(session.elapsedPausedMs).toBe(5_000)
        })
    })

    describe('preview control', () => {
        test('startPreview starts preview with video track', async () => {
            const config = createDefaultConfig()
            await session.start(defaultRequest, config)

            session.startPreview()
            expect(preview.start).toHaveBeenCalled()
        })

        test('stopPreview stops preview', async () => {
            session.stopPreview()
            expect(preview.stop).toHaveBeenCalled()
        })
    })

    describe('crop region', () => {
        test('updateCropRegion updates crop region', () => {
            const region = { x: 100, y: 200, width: 300, height: 400 }
            session.updateCropRegion(region)
            expect(crop.region).toEqual(region)
        })
    })
})
