import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getChromeMock } from './test-setup'
import type { Player } from '../../src/element/player'
import { Settings } from '../../src/element/settings'
import { Configuration } from '../../src/configuration'
import type { TranscriptionResult } from '../../src/transcription/types'

// Mock api_client & OPFSModelCache using vi.hoisted
const {
    hasCacheMock,
    getTranscriptionMock,
    deleteTranscriptionMock,
    getSummaryMock,
    deleteSummaryMock,
    ensureControlledMock,
} = vi.hoisted(() => ({
    hasCacheMock: vi.fn().mockResolvedValue(true),
    getTranscriptionMock: vi.fn(),
    deleteTranscriptionMock: vi.fn(),
    getSummaryMock: vi.fn(),
    deleteSummaryMock: vi.fn(),
    ensureControlledMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/api_client', () => ({
    recordingApi: {
        ensureControlled: (...args: unknown[]) => ensureControlledMock(...args),
        getTranscription: (...args: unknown[]) => getTranscriptionMock(...args),
        deleteTranscription: (...args: unknown[]) => deleteTranscriptionMock(...args),
        getSummary: (...args: unknown[]) => getSummaryMock(...args),
        deleteSummary: (...args: unknown[]) => deleteSummaryMock(...args),
    },
}))

vi.mock('../../src/ml/opfs_model_cache', () => {
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
        getSummaryMock.mockReset().mockResolvedValue(null)
        deleteSummaryMock.mockReset().mockResolvedValue(undefined)

        // Enable transcription and summary in configuration
        const config = new Configuration()
        config.transcription.enabled = true
        config.transcription.language = 'en'
        config.summary.enabled = true
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

        // Verify download menu with md-menu and md-menu-item
        expect(customElements.get('md-menu-item')).toBeDefined()
        const menu = shadowQuery(el, 'md-menu')
        expect(menu).not.toBeNull()
        const menuItems = el.shadowRoot?.querySelectorAll('md-menu-item')
        expect(menuItems?.length).toBe(2)
        expect(menuItems?.[0]?.getAttribute('href')).toMatch(/transcription\.vtt/)
        expect(menuItems?.[1]?.getAttribute('href')).toMatch(/transcription\.srt/)

        // Click download menu anchor toggles menu
        const anchorBtn = shadowQuery(el, '#download-menu-anchor') as HTMLElement
        expect(anchorBtn).not.toBeNull()
        anchorBtn.click()
        await elementUpdated(el)
        expect((el as any).showDownloadMenu).toBe(true)
    })

    test('renders start transcription button when transcription has not been executed', async () => {
        getTranscriptionMock.mockResolvedValue(null)

        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as Player
        el.path = 'test-recording.webm'
        await elementUpdated(el)

        await vi.waitFor(() => {
            expect(getTranscriptionMock).toHaveBeenCalledWith('test-recording.webm')
        })
        await elementUpdated(el)

        const startButton = shadowQuery(el, '.status-center md-filled-button')
        expect(startButton).not.toBeNull()
        expect(startButton?.textContent).toContain('Transcribe')
        expect(shadowQuery(el, '.segment-list')).toBeNull()
        expect(shadowQuery(el, '.panel-actions')).toBeNull()
    })

    test('renders no speech detected message when transcription has no segments', async () => {
        const mockResult: TranscriptionResult = {
            transcribedAt: 1234567890,
            modelId: 'openai/whisper-tiny',
            language: 'en',
            segments: [],
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

        // Should render playerNoSpeechDetected message
        const noSpeechText = shadowQuery(el, '.status-center p')
        expect(noSpeechText).not.toBeNull()
        expect(noSpeechText?.textContent).toBe('No speech detected.')

        // Should NOT render start transcription button or segment list
        expect(shadowQuery(el, '.status-center md-filled-button')).toBeNull()
        expect(shadowQuery(el, '.segment-list')).toBeNull()

        // Should render delete button, but not summary or download buttons
        expect(shadowQuery(el, 'md-icon-button[title="Delete Transcription"]')).not.toBeNull()
        expect(shadowQuery(el, '#summary-button')).toBeNull()
        expect(shadowQuery(el, '#download-menu-anchor')).toBeNull()
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

    test('renders summary dialog with markdown formatted text using marked', async () => {
        const markdownContent = '# Executive Summary\n\n- Key finding 1\n- Key finding 2\n\nThis is **important**.'
        getSummaryMock.mockResolvedValue({
            text: markdownContent,
            summarizedAt: Date.now(),
            modelId: 'test-model',
        })

        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        el.summaryText = markdownContent
        el.showSummaryDialog = true
        await elementUpdated(el)

        const summaryBody = shadowQuery(el, '.summary-body')
        expect(summaryBody).not.toBeNull()

        // Marked should have converted headers and list items to HTML tags
        const h1 = summaryBody?.querySelector('h1')
        expect(h1).not.toBeNull()
        expect(h1?.textContent).toBe('Executive Summary')

        const listItems = summaryBody?.querySelectorAll('li')
        expect(listItems?.length).toBe(2)
        expect(listItems?.[0]?.textContent).toBe('Key finding 1')

        const strong = summaryBody?.querySelector('strong')
        expect(strong).not.toBeNull()
        expect(strong?.textContent).toBe('important')
    })

    test('copies raw markdown text to clipboard when copy button is clicked', async () => {
        const markdownContent = '# Title\n\n- item'
        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        el.summaryText = markdownContent
        el.showSummaryDialog = true
        await elementUpdated(el)

        const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

        const copyButton = shadowQuery(el, 'md-dialog[open] md-filled-tonal-button') as HTMLElement
        expect(copyButton).not.toBeNull()
        copyButton.click()
        await elementUpdated(el)

        // Verifies raw markdown format is maintained
        expect(writeTextSpy).toHaveBeenCalledWith(markdownContent)
    })

    test('shows redownload required error with open settings button when summary model cache is missing', async () => {
        hasCacheMock.mockResolvedValue(false)
        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        el.summaryText = 'Existing summary'
        el.showSummaryDialog = true
        await elementUpdated(el)

        // Click re-summary / trigger startSummary
        await el.startSummary()
        await elementUpdated(el)

        expect(el.needsSummaryModelRedownload).toBe(true)
        expect(el.summaryError).toBe(
            'Summary model is missing or corrupted. Please redownload the model from Settings.',
        )

        const errorBanner = shadowQuery(el, 'md-dialog[open] .error-banner')
        expect(errorBanner).not.toBeNull()
        expect(errorBanner?.textContent).toContain(
            'Summary model is missing or corrupted. Please redownload the model from Settings.',
        )

        const openSettingsButton = errorBanner?.querySelector('.open-settings-button') as HTMLElement
        expect(openSettingsButton).not.toBeNull()

        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
        openSettingsButton.click()
        expect(windowOpenSpy).toHaveBeenCalledWith(
            expect.stringContaining('option.html?tab=settings#summary'),
            '_blank',
        )
    })

    test('opens settings with #summary when summary model is not ready', async () => {
        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        el.showSummaryDialog = true
        el.isSummaryModelReady = false
        await elementUpdated(el)

        const openSettingsBtn = shadowQuery(el, 'md-dialog[open] md-filled-button') as HTMLElement
        expect(openSettingsBtn).not.toBeNull()

        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
        openSettingsBtn.click()
        expect(windowOpenSpy).toHaveBeenCalledWith(
            expect.stringContaining('option.html?tab=settings#summary'),
            '_blank',
        )
    })

    test('starts summary when summary model cache is valid', async () => {
        hasCacheMock.mockResolvedValue(true)
        const screen = render(html`<extension-player></extension-player>`)
        const el = screen.container.querySelector('extension-player') as any
        el.path = 'test-recording.webm'
        el.showSummaryDialog = true
        await elementUpdated(el)

        await el.startSummary()
        await elementUpdated(el)

        const chromeMock = getChromeMock()
        expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'start-summary',
            path: 'test-recording.webm',
        })
    })
})
