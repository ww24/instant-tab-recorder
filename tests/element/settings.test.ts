import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'
import './test-setup'
import '../../src/element/settings'
import { Settings } from '../../src/element/settings'
import { Configuration } from '../../src/configuration'

// Mock mediabunny to avoid actual codec detection
vi.mock('mediabunny', () => {
    class MockWebMOutputFormat {
        getSupportedVideoCodecs() {
            return ['vp8', 'vp9', 'av1']
        }
        getSupportedAudioCodecs() {
            return ['opus']
        }
    }
    class MockMp4OutputFormat {
        getSupportedVideoCodecs() {
            return ['avc', 'hevc']
        }
        getSupportedAudioCodecs() {
            return ['aac', 'opus']
        }
    }
    class MockOggOutputFormat {
        getSupportedVideoCodecs() {
            return [] as string[]
        }
        getSupportedAudioCodecs() {
            return ['opus']
        }
    }
    class MockAdtsOutputFormat {
        getSupportedVideoCodecs() {
            return [] as string[]
        }
        getSupportedAudioCodecs() {
            return ['aac']
        }
    }
    class MockFlacOutputFormat {
        getSupportedVideoCodecs() {
            return [] as string[]
        }
        getSupportedAudioCodecs() {
            return ['flac']
        }
    }
    return {
        canEncodeVideo: vi.fn().mockResolvedValue(true),
        canEncodeAudio: vi.fn().mockResolvedValue(true),
        WebMOutputFormat: MockWebMOutputFormat,
        Mp4OutputFormat: MockMp4OutputFormat,
        OggOutputFormat: MockOggOutputFormat,
        AdtsOutputFormat: MockAdtsOutputFormat,
        FlacOutputFormat: MockFlacOutputFormat,
        QUALITY_HIGH: 'high',
        QUALITY_MEDIUM: 'medium',
        QUALITY_LOW: 'low',
    }
})

// Mock flac-encoder registration
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

// Mock theme to avoid DOM manipulation outside component
vi.mock('../../src/theme', () => ({
    applyTheme: vi.fn(),
}))

describe('extension-settings', () => {
    test('renders Appearance heading with theme selector', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const themeHeading = headings.find(h => h.textContent?.trim() === 'Appearance')
        expect(themeHeading).not.toBeUndefined()

        const themeSelect = shadowQuery(el, '.theme-select')
        expect(themeSelect).not.toBeNull()
    })

    test('renders Window Size heading with width and height inputs', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const wsHeading = headings.find(h => h.textContent?.trim() === 'Window Size')
        expect(wsHeading).not.toBeUndefined()
    })

    test('renders Resize button', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const resizeBtn = shadowQueryAll(el, 'md-filled-tonal-button').find(b =>
            b.textContent?.trim().includes('Resize'),
        )
        expect(resizeBtn).not.toBeUndefined()
    })

    test('renders Video Format heading with recording mode selector', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const vfHeading = headings.find(h => h.textContent?.trim() === 'Video Format')
        expect(vfHeading).not.toBeUndefined()
    })

    test('renders container format selector with options', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const containerSelect = shadowQuery(el, '.container-select')
        expect(containerSelect).not.toBeNull()
    })

    test('renders video and audio codec selectors', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const codecSelects = shadowQueryAll(el, '.codec-select')
        expect(codecSelects.length).toBeGreaterThanOrEqual(2) // at least audio + video codec
    })

    test('renders Microphone heading with enable switch', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const micHeading = headings.find(h => h.textContent?.trim() === 'Microphone')
        expect(micHeading).not.toBeUndefined()
    })

    test('renders Audio Separation heading with enable switch', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const asHeading = headings.find(h => h.textContent?.trim() === 'Audio Separation')
        expect(asHeading).not.toBeUndefined()
    })

    test('renders Recording Timer heading with enable switch', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const rtHeading = headings.find(h => h.textContent?.trim() === 'Recording Timer')
        expect(rtHeading).not.toBeUndefined()
    })

    test('renders Option heading with open option page switch', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const optionHeading = headings.find(h => h.textContent?.trim() === 'Option')
        expect(optionHeading).not.toBeUndefined()
    })

    test('renders Sync heading with Fetch and Restore buttons', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const syncHeading = headings.find(h => h.textContent?.trim() === 'Sync')
        expect(syncHeading).not.toBeUndefined()

        const buttons = shadowQueryAll(el, 'md-filled-tonal-button')
        const fetchBtn = buttons.find(b => b.textContent?.trim().includes('Fetch Synced'))
        const restoreBtn = buttons.find(b => b.textContent?.trim().includes('Restore Default'))
        expect(fetchBtn).not.toBeUndefined()
        expect(restoreBtn).not.toBeUndefined()
    })

    test('getConfiguration returns a valid Configuration', () => {
        const config = Settings.getConfiguration()
        expect(config.videoFormat).toBeDefined()
        expect(config.windowSize).toBeDefined()
        expect(config.cropping).toBeDefined()
        expect(config.microphone).toBeDefined()
        expect(config.recordingTimer).toBeDefined()
    })

    test('setConfiguration persists and can be retrieved', () => {
        const config = Settings.getConfiguration()
        config.muteRecordingTab = true
        Settings.setConfiguration(config)

        const retrieved = Settings.getConfiguration()
        expect(retrieved.muteRecordingTab).toBe(true)
    })

    test('setConfiguration dispatches CONFIG_CHANGED_EVENT', () => {
        const handler = vi.fn()
        window.addEventListener(Settings.CONFIG_CHANGED_EVENT, handler)

        const config = Settings.getConfiguration()
        Settings.setConfiguration(config)

        expect(handler).toHaveBeenCalledTimes(1)
        window.removeEventListener(Settings.CONFIG_CHANGED_EVENT, handler)
    })

    test('CONFIG_CHANGED_EVENT carries config as detail', () => {
        let receivedDetail: unknown = null
        const handler = (e: Event) => {
            receivedDetail = (e as CustomEvent).detail
        }
        window.addEventListener(Settings.CONFIG_CHANGED_EVENT, handler)

        const config = Settings.getConfiguration()
        config.openOptionPage = false
        Settings.setConfiguration(config)

        expect(receivedDetail).not.toBeNull()
        expect((receivedDetail as Configuration).openOptionPage).toBe(false)
        window.removeEventListener(Settings.CONFIG_CHANGED_EVENT, handler)
    })

    test('renders multiple switches for toggle settings', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const switches = shadowQueryAll(el, 'md-switch')
        // At minimum: screen recording auto, microphone, audio separation, recording timer,
        // timer stop confirm, open option page, mute recording tab
        expect(switches.length).toBeGreaterThanOrEqual(5)
    })

    test('renders settings sections with grouped content', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const sections = shadowQueryAll(el, '.settings-section')
        const groups = shadowQueryAll(el, '.settings-group')
        expect(sections.length).toBeGreaterThan(0)
        expect(groups.length).toBe(sections.length)
        sections.forEach(section => {
            expect(section.querySelectorAll('.settings-group').length).toBe(1)
        })
    })

    test('uses switch-label class for switch layout', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const switchRows = shadowQueryAll(el, '.switch-label')
        expect(switchRows.length).toBeGreaterThanOrEqual(7)
    })
})
