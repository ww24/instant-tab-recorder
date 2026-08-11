import type { Mock } from 'vitest'

vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import { AudioSeparationManager } from '../../src/recorder/audio_separation'
import type { AudioSeparationOutputs } from '../../src/recorder/audio_separation'
import type { FileManager } from '../../src/recorder/file_manager'
import type { OutputManager, OutputHandle } from '../../src/recorder/output_manager'
import { VideoFormat } from '../../src/configuration'

// ---------- mocks ----------

function createMockFileManager(overrides: Partial<FileManager> = {}): FileManager {
    const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue({}),
    }
    return {
        createRecordingFile: vi.fn().mockResolvedValue(mockFileHandle),
        createAudioFile: vi.fn().mockResolvedValue(mockFileHandle),
        ...overrides,
    } as unknown as FileManager
}

function createMockOutputManager(): OutputManager & { createAudioTrackOutput: Mock } {
    return {
        createOutput: vi.fn(),
        addTracks: vi.fn().mockReturnValue({ sources: [], errorPromises: [] }),
        createAudioTrackOutput: vi.fn((): OutputHandle => ({
            output: {
                start: vi.fn().mockResolvedValue(undefined),
                finalize: vi.fn().mockResolvedValue(undefined),
                cancel: vi.fn().mockResolvedValue(undefined),
                addAudioTrack: vi.fn(),
                state: 'idle',
            } as unknown as import('mediabunny').Output,
            sources: [],
            errorPromises: [Promise.resolve()],
        })),
    } as unknown as OutputManager & { createAudioTrackOutput: Mock }
}

function createMockTrack(kind: 'audio' | 'video', id = '1'): MediaStreamTrack {
    return {
        kind,
        id,
        stop: vi.fn(),
        clone: vi.fn(function (this: MediaStreamTrack) {
            return createMockTrack(kind, `${id}-clone`)
        }),
    } as unknown as MediaStreamTrack
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

// ---------- AudioSeparationManager ----------

describe('AudioSeparationManager', () => {
    describe('createOutputs', () => {
        test('creates tab + mic outputs when video-and-audio mode with mic', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream([createMockTrack('audio', 'tab')])
            const micStream = createMockStream([createMockTrack('audio', 'mic')])
            const vf = createVideoFormat({ recordingMode: 'video-and-audio', audioCodec: 'opus' })

            const result = await mgr.createOutputs(1000, tabMedia, micStream, vf)

            expect(result.tabOutput).toBeDefined()
            expect(result.micOutput).toBeDefined()
            expect(result.clonedTracks).toHaveLength(2)
            expect(fileMgr.createAudioFile).toHaveBeenCalledTimes(2)
            // Tab file: video-1000-tab.ogg (opus → ogg)
            expect(fileMgr.createAudioFile).toHaveBeenCalledWith('video-1000-tab.ogg')
            expect(fileMgr.createAudioFile).toHaveBeenCalledWith('video-1000-mic.ogg')
        })

        test('creates only tab output when video-and-audio mode without mic', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream([createMockTrack('audio', 'tab')])
            const vf = createVideoFormat({ recordingMode: 'video-and-audio', audioCodec: 'aac' })

            const result = await mgr.createOutputs(2000, tabMedia, null, vf)

            expect(result.tabOutput).toBeDefined()
            expect(result.micOutput).toBeUndefined()
            expect(result.clonedTracks).toHaveLength(1)
            // aac → adts → .aac extension
            expect(fileMgr.createAudioFile).toHaveBeenCalledWith('video-2000-tab.aac')
        })

        test('creates tab + mic outputs when audio-only mode with mic', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream([createMockTrack('audio', 'tab')])
            const micStream = createMockStream([createMockTrack('audio', 'mic')])
            const vf = createVideoFormat({ recordingMode: 'audio-only', audioCodec: 'opus' })

            const result = await mgr.createOutputs(1500, tabMedia, micStream, vf)

            expect(result.tabOutput).toBeDefined()
            expect(result.micOutput).toBeDefined()
            expect(result.clonedTracks).toHaveLength(2)
            expect(fileMgr.createAudioFile).toHaveBeenCalledTimes(2)
            expect(fileMgr.createAudioFile).toHaveBeenCalledWith('video-1500-tab.ogg')
            expect(fileMgr.createAudioFile).toHaveBeenCalledWith('video-1500-mic.ogg')
        })

        test('creates no outputs when audio-only mode without mic', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream([createMockTrack('audio', 'tab')])
            const vf = createVideoFormat({ recordingMode: 'audio-only', audioCodec: 'opus' })

            const result = await mgr.createOutputs(1600, tabMedia, null, vf)

            expect(result.tabOutput).toBeUndefined()
            expect(result.micOutput).toBeUndefined()
            expect(result.clonedTracks).toHaveLength(0)
            expect(fileMgr.createAudioFile).not.toHaveBeenCalled()
        })

        test('creates only mic output when video-only mode with mic', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream([createMockTrack('audio', 'tab')])
            const micStream = createMockStream([createMockTrack('audio', 'mic')])
            const vf = createVideoFormat({ recordingMode: 'video-only', audioCodec: 'opus' })

            const result = await mgr.createOutputs(3000, tabMedia, micStream, vf)

            // video-only → no tab separation
            expect(result.tabOutput).toBeUndefined()
            expect(result.micOutput).toBeDefined()
            expect(result.clonedTracks).toHaveLength(1)
        })

        test('creates no outputs when no audio tracks available', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream() // no audio tracks
            const vf = createVideoFormat({ recordingMode: 'video-and-audio' })

            const result = await mgr.createOutputs(4000, tabMedia, null, vf)

            expect(result.tabOutput).toBeUndefined()
            expect(result.micOutput).toBeUndefined()
            expect(result.clonedTracks).toHaveLength(0)
        })

        test('uses flac container for flac codec', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabMedia = createMockStream([createMockTrack('audio', 'tab')])
            const vf = createVideoFormat({ recordingMode: 'video-and-audio', audioCodec: 'flac' })

            await mgr.createOutputs(5000, tabMedia, null, vf)

            expect(fileMgr.createAudioFile).toHaveBeenCalledWith('video-5000-tab.flac')
        })
    })

    describe('finalizeAll', () => {
        test('finalizes both outputs', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabFinalize = vi.fn().mockResolvedValue(undefined)
            const micFinalize = vi.fn().mockResolvedValue(undefined)
            const outputs: AudioSeparationOutputs = {
                tabOutput: { finalize: tabFinalize, cancel: vi.fn() } as unknown as import('mediabunny').Output,
                micOutput: { finalize: micFinalize, cancel: vi.fn() } as unknown as import('mediabunny').Output,
                sources: [],
                clonedTracks: [],
                errorPromises: [],
            }

            await mgr.finalizeAll(outputs)

            expect(tabFinalize).toHaveBeenCalled()
            expect(micFinalize).toHaveBeenCalled()
        })

        test('finalizes mic even when tab finalize fails, then throws', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabFinalize = vi.fn().mockRejectedValue(new Error('tab finalize error'))
            const micFinalize = vi.fn().mockResolvedValue(undefined)
            const outputs: AudioSeparationOutputs = {
                tabOutput: { finalize: tabFinalize, cancel: vi.fn() } as unknown as import('mediabunny').Output,
                micOutput: { finalize: micFinalize, cancel: vi.fn() } as unknown as import('mediabunny').Output,
                sources: [],
                clonedTracks: [],
                errorPromises: [],
            }

            await expect(mgr.finalizeAll(outputs)).rejects.toThrow('Failed to finalize audio separation')

            expect(tabFinalize).toHaveBeenCalled()
            expect(micFinalize).toHaveBeenCalled()
        })

        test('finalizes tab even when mic finalize fails, then throws', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabFinalize = vi.fn().mockResolvedValue(undefined)
            const micFinalize = vi.fn().mockRejectedValue(new Error('mic finalize error'))
            const outputs: AudioSeparationOutputs = {
                tabOutput: { finalize: tabFinalize, cancel: vi.fn() } as unknown as import('mediabunny').Output,
                micOutput: { finalize: micFinalize, cancel: vi.fn() } as unknown as import('mediabunny').Output,
                sources: [],
                clonedTracks: [],
                errorPromises: [],
            }

            await expect(mgr.finalizeAll(outputs)).rejects.toThrow('Failed to finalize audio separation')

            expect(tabFinalize).toHaveBeenCalled()
            expect(micFinalize).toHaveBeenCalled()
        })
    })

    describe('cancelAll', () => {
        test('cancels both outputs', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabCancel = vi.fn().mockResolvedValue(undefined)
            const micCancel = vi.fn().mockResolvedValue(undefined)
            const outputs: AudioSeparationOutputs = {
                tabOutput: { finalize: vi.fn(), cancel: tabCancel } as unknown as import('mediabunny').Output,
                micOutput: { finalize: vi.fn(), cancel: micCancel } as unknown as import('mediabunny').Output,
                sources: [],
                clonedTracks: [],
                errorPromises: [],
            }

            await mgr.cancelAll(outputs)

            expect(tabCancel).toHaveBeenCalled()
            expect(micCancel).toHaveBeenCalled()
        })

        test('cancels mic even when tab cancel fails, then throws', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabCancel = vi.fn().mockRejectedValue(new Error('tab cancel error'))
            const micCancel = vi.fn().mockResolvedValue(undefined)
            const outputs: AudioSeparationOutputs = {
                tabOutput: { finalize: vi.fn(), cancel: tabCancel } as unknown as import('mediabunny').Output,
                micOutput: { finalize: vi.fn(), cancel: micCancel } as unknown as import('mediabunny').Output,
                sources: [],
                clonedTracks: [],
                errorPromises: [],
            }

            await expect(mgr.cancelAll(outputs)).rejects.toThrow('Failed to cancel audio separation')

            expect(tabCancel).toHaveBeenCalled()
            expect(micCancel).toHaveBeenCalled()
        })

        test('cancels tab even when mic cancel fails, then throws', async () => {
            const fileMgr = createMockFileManager()
            const outMgr = createMockOutputManager()
            const mgr = new AudioSeparationManager(fileMgr, outMgr)

            const tabCancel = vi.fn().mockResolvedValue(undefined)
            const micCancel = vi.fn().mockRejectedValue(new Error('mic cancel error'))
            const outputs: AudioSeparationOutputs = {
                tabOutput: { finalize: vi.fn(), cancel: tabCancel } as unknown as import('mediabunny').Output,
                micOutput: { finalize: vi.fn(), cancel: micCancel } as unknown as import('mediabunny').Output,
                sources: [],
                clonedTracks: [],
                errorPromises: [],
            }

            await expect(mgr.cancelAll(outputs)).rejects.toThrow('Failed to cancel audio separation')

            expect(tabCancel).toHaveBeenCalled()
            expect(micCancel).toHaveBeenCalled()
        })
    })
})
