import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getChromeMock } from './test-setup'
import type { Player } from '../../src/element/player'
import { Settings } from '../../src/element/settings'
import { Configuration } from '../../src/configuration'
import type { TranscriptionResult } from '../../src/transcription/types'

// Mock api_client
const getTranscriptionMock = vi.fn()
const deleteTranscriptionMock = vi.fn()

const ensureControlledMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/api_client', () => ({
    recordingApi: {
        ensureControlled: (...args: unknown[]) => ensureControlledMock(...args),
        getTranscription: (...args: unknown[]) => getTranscriptionMock(...args),
        deleteTranscription: (...args: unknown[]) => deleteTranscriptionMock(...args),
    },
}))

const hasCacheMock = vi.fn().mockResolvedValue(true)
vi.mock('../../src/transcription/opfs_model_cache', () => {
    class MockOPFSModelCache {
        hasCache = (...args: unknown[]) => hasCacheMock(...args)
    }
    return {
        OPFSModelCache: MockOPFSModelCache,
    }
})

// Import player after mocks
import '../../src/element/player'

describe('extension-player', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        getTranscriptionMock.mockReset().mockResolvedValue(null)
        deleteTranscriptionMock.mockReset().mockResolvedValue(undefined)

        // Enable transcription in configuration
        const config = new Configuration()
        config.transcription = {
            enabled: true,
            language: 'en',
        }
        Settings.setConfiguration(config)
    })

    test('renders video player', async () => {
        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as Player
        await elementUpdated(el)

        const video = shadowQuery(el, 'video')
        expect(video).not.toBeNull()
    })

    test('fetches transcription via recordingApi when path is provided', async () => {
        const mockResult: TranscriptionResult = {
            transcribedAt: 1234567890,
            modelId: 'openai/whisper-tiny',
            language: 'en',
            segments: [
                {
                    startSec: 0,
                    endSec: 2,
                    text: 'Hello world segment',
                },
            ],
        }
        getTranscriptionMock.mockResolvedValue(mockResult)

        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as Player
        el.path = 'test-recording.webm'
        await elementUpdated(el)

        await vi.waitFor(() => {
            expect(ensureControlledMock).toHaveBeenCalled()
            expect(getTranscriptionMock).toHaveBeenCalledWith('test-recording.webm')
        })

        await elementUpdated(el)
        const segmentText = shadowQuery(el, '.segment-item .text')
        expect(segmentText?.textContent).toBe('Hello world segment')

        const track = shadowQuery(el, 'video track') as HTMLTrackElement | null
        expect(track).not.toBeNull()
        expect(track?.src).toMatch(/transcription\.vtt/)
    })

    test('deletes transcription via recordingApi on confirmDelete', async () => {
        const mockResult: TranscriptionResult = {
            transcribedAt: 1234567890,
            modelId: 'openai/whisper-tiny',
            language: 'en',
            segments: [
                {
                    startSec: 0,
                    endSec: 2,
                    text: 'Hello world segment',
                },
            ],
        }
        getTranscriptionMock.mockResolvedValue(mockResult)

        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as Player
        el.path = 'test-recording.webm'
        await elementUpdated(el)

        await vi.waitFor(() => {
            expect(getTranscriptionMock).toHaveBeenCalledWith('test-recording.webm')
        })
        await elementUpdated(el)

        // Trigger confirmDelete
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (el as any).confirmDelete()

        expect(deleteTranscriptionMock).toHaveBeenCalledWith('test-recording.webm')
        const chromeMock = getChromeMock()
        expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'transcription-deleted',
            path: 'test-recording.webm',
        })

        await elementUpdated(el)
        expect(shadowQuery(el, 'video track')).toBeNull()
    })

    test('shows model redownload error and open settings button when hasCache returns false', async () => {
        hasCacheMock.mockResolvedValue(false)
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        await elementUpdated(el)

        await el.startTranscription()
        await elementUpdated(el)

        const errorBanner = shadowQuery(el, '.error-banner')
        expect(errorBanner).not.toBeNull()
        expect(errorBanner?.textContent).toContain('Transcription model is missing or corrupted')

        const openSettingsBtn = shadowQuery(el, '.open-settings-button')
        expect(openSettingsBtn).not.toBeNull()

        // Click settings button
        openSettingsBtn?.dispatchEvent(new Event('click'))
        expect(windowOpenSpy).toHaveBeenCalledWith(
            expect.stringContaining('option.html?tab=settings#transcription'),
            '_blank',
        )

        const chromeMock = getChromeMock()
        expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'start-transcription' }),
        )
    })

    test('starts transcription when hasCache returns true', async () => {
        hasCacheMock.mockResolvedValue(true)

        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        await elementUpdated(el)

        await el.startTranscription()
        await elementUpdated(el)

        const chromeMock = getChromeMock()
        expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'start-transcription',
            path: 'test-recording.webm',
        })
    })
})
