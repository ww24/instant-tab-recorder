import type { Mock } from 'vitest'

import { AudioMixer, SingletonAudioContextFactory } from '../../src/recorder/audio_mixer'
import type { AudioContextFactory } from '../../src/recorder/audio_mixer'

// MediaStream is not available in Node; provide a minimal polyfill for tests
globalThis.MediaStream = class MockMediaStream {
    private tracks: MediaStreamTrack[]
    constructor(tracks?: MediaStreamTrack[]) {
        this.tracks = tracks ?? []
    }
    getAudioTracks() {
        return this.tracks.filter(t => t.kind === 'audio')
    }
    getVideoTracks() {
        return this.tracks.filter(t => t.kind === 'video')
    }
    getTracks() {
        return [...this.tracks]
    }
} as unknown as typeof MediaStream

// ---------- mocks ----------

function createMockTrack(kind: 'audio' | 'video', id = '1'): MediaStreamTrack {
    const listeners = new Map<string, EventListener[]>()
    return {
        kind,
        id,
        stop: vi.fn(),
        addEventListener: vi.fn((event: string, listener: EventListener) => {
            if (!listeners.has(event)) listeners.set(event, [])
            listeners.get(event)!.push(listener)
        }),
        // helper to fire 'ended'
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
        getTracks: vi.fn(() => [...audioTracks, ...videoTracks]),
    } as unknown as MediaStream
}

interface MockMediaStreamDestination {
    stream: MediaStream
}

function createMockAudioContext(): AudioContext & {
    mockDest: MockMediaStreamDestination
    mockGains: Array<{ gain: { value: number }; connect: Mock }>
    mockSources: Array<{ connect: Mock }>
} {
    const destTracks = [createMockTrack('audio', 'dest-audio')]
    const destStream = createMockStream(destTracks)
    const dest: MockMediaStreamDestination = { stream: destStream }

    const gains: Array<{ gain: { value: number }; connect: Mock }> = []
    const sources: Array<{ connect: Mock }> = []

    return {
        mockDest: dest,
        mockGains: gains,
        mockSources: sources,
        destination: {} as AudioDestinationNode,
        createMediaStreamDestination: vi.fn(() => dest),
        createMediaStreamSource: vi.fn(() => {
            const src = { connect: vi.fn() }
            sources.push(src)
            return src
        }),
        createGain: vi.fn(() => {
            const gain = { gain: { value: 1 }, connect: vi.fn() }
            gains.push(gain)
            return gain
        }),
    } as unknown as AudioContext & {
        mockDest: MockMediaStreamDestination
        mockGains: Array<{ gain: { value: number }; connect: Mock }>
        mockSources: Array<{ connect: Mock }>
    }
}

function createMockFactory(mockCtx: AudioContext): AudioContextFactory {
    return { create: vi.fn(() => mockCtx) }
}

// ---------- SingletonAudioContextFactory ----------

describe('SingletonAudioContextFactory', () => {
    // These tests verify the API shape; actual AudioContext can't run in Node

    test('create returns the same instance on subsequent calls', () => {
        const factory = new SingletonAudioContextFactory()
        // Can't construct a real AudioContext in Node, so we patch it
        const fakeCtx = {} as AudioContext
        ;(factory as unknown as { audioCtx: AudioContext }).audioCtx = fakeCtx
        expect(factory.create(44100)).toBe(fakeCtx)
    })
})

// ---------- AudioMixer ----------

describe('AudioMixer', () => {
    describe('mix', () => {
        test('returns tabStream directly when no mic and no audio tracks', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabStream = createMockStream([], [createMockTrack('video')])
            const result = mixer.mix(tabStream, null, 1.0, 0)

            // No resampling needed — returns original stream
            expect(result).toBe(tabStream)
        })

        test('returns tabStream directly when no mic, sampleRate=0, and has audio', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabStream = createMockStream([createMockTrack('audio')], [createMockTrack('video')])
            const result = mixer.mix(tabStream, null, 1.0, 0)

            expect(result).toBe(tabStream)
        })

        test('resamples via AudioContext when no mic but custom sampleRate > 0', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabStream = createMockStream([createMockTrack('audio')], [createMockTrack('video')])
            const result = mixer.mix(tabStream, null, 1.0, 44100)

            // Should create destination and source
            expect(ctx.createMediaStreamDestination).toHaveBeenCalled()
            expect(ctx.createMediaStreamSource).toHaveBeenCalled()
            // Result is a new MediaStream (not the original)
            expect(result).not.toBe(tabStream)
        })

        test('mixes tab + mic audio with gain when mic is provided', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabStream = createMockStream([createMockTrack('audio')], [createMockTrack('video')])
            const micStream = createMockStream([createMockTrack('audio', 'mic')])

            const result = mixer.mix(tabStream, micStream, 0.5, 44100)

            // Should create gain node for mic
            expect(ctx.createGain).toHaveBeenCalled()
            expect(ctx.mockGains[0].gain.value).toBe(0.5)
            // Tab audio source connected
            expect(ctx.mockSources.length).toBeGreaterThanOrEqual(2)
            // Result is a new MediaStream
            expect(result).not.toBe(tabStream)
        })

        test('mixes mic-only audio when tab has no audio tracks', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabStream = createMockStream([], [createMockTrack('video')])
            const micStream = createMockStream([createMockTrack('audio', 'mic')])

            mixer.mix(tabStream, micStream, 1.0, 44100)

            // Should still create destination and mic source
            expect(ctx.createMediaStreamDestination).toHaveBeenCalled()
            expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(1) // Only mic
            expect(ctx.createGain).toHaveBeenCalled()
        })

        test('ended event on tab track stops destination tracks (resample path)', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabAudio = createMockTrack('audio')
            const tabVideo = createMockTrack('video')
            const tabStream = createMockStream([tabAudio], [tabVideo])

            mixer.mix(tabStream, null, 1.0, 44100)

            // Fire 'ended' on the first track returned by getTracks()
            const firstTrack = tabStream.getTracks()[0]
            firstTrack.dispatchEvent(new Event('ended'))

            // dest audio tracks should have been stopped
            const destTracks = ctx.mockDest.stream.getAudioTracks()
            destTracks.forEach(t => expect(t.stop).toHaveBeenCalled())
        })

        test('ended event on tab track stops destination tracks (mix path)', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabAudio = createMockTrack('audio')
            const tabVideo = createMockTrack('video')
            const tabStream = createMockStream([tabAudio], [tabVideo])
            const micStream = createMockStream([createMockTrack('audio', 'mic')])

            mixer.mix(tabStream, micStream, 1.0, 44100)

            const firstTrack = tabStream.getTracks()[0]
            firstTrack.dispatchEvent(new Event('ended'))

            const destTracks = ctx.mockDest.stream.getAudioTracks()
            destTracks.forEach(t => expect(t.stop).toHaveBeenCalled())
        })
    })

    describe('setupPlayback', () => {
        test('connects tab media source to AudioContext destination', () => {
            const ctx = createMockAudioContext()
            const mixer = new AudioMixer(createMockFactory(ctx))

            const tabMedia = createMockStream([createMockTrack('audio')])
            mixer.setupPlayback(tabMedia, 44100)

            expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(tabMedia)
            expect(ctx.mockSources[0].connect).toHaveBeenCalledWith(ctx.destination)
        })
    })
})
