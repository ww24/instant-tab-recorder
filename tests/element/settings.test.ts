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

const mockCheckWebGPUSupport = vi.fn().mockResolvedValue({ supported: true })
vi.mock('../../src/transcription/webgpu', () => ({
    checkWebGPUSupport: () => mockCheckWebGPUSupport(),
}))

const mockHasCache = vi.fn().mockResolvedValue(true)
const mockClear = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/transcription/opfs_model_cache', () => {
    class MockOPFSModelCache {
        hasCache = () => mockHasCache()
        clear = () => mockClear()
    }
    return {
        OPFSModelCache: MockOPFSModelCache,
    }
})

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

    test('displays correct transcription hint text depending on state', async () => {
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings') as any
        await elementUpdated(el)

        // 1. Off state (default)
        const expSection = shadowQuery(el, '.experimental-section')!
        const hintEl = expSection.querySelector('.settings-hint')!
        expect(hintEl.textContent?.trim()).toBe(
            'When enabled, transcription works entirely within your local environment.\nApproximately 1.4 GB of model data will be downloaded, so please be mindful of your network environment.',
        )

        // 2. Downloading state
        el.isModelDownloading = true
        el.requestUpdate()
        await elementUpdated(el)
        expect(hintEl.textContent?.trim()).toBe('Disabling will cancel the model data download.')

        // 3. Enabled & cached state
        el.isModelDownloading = false
        const config = Settings.getConfiguration()
        config.transcription.enabled = true
        Settings.setConfiguration(config)
        el.config = config
        el.requestUpdate()
        await elementUpdated(el)
        expect(hintEl.textContent?.trim()).toBe('Disabling will delete the cached model data (~1.4 GB).')
    })

    test('disables transcription switch and shows unsupported message when WebGPU is not supported on toggle', async () => {
        mockCheckWebGPUSupport.mockResolvedValueOnce({ supported: false, reason: 'no-webgpu' })
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        expect(transcriptionSwitch).not.toBeNull()
        expect(transcriptionSwitch.disabled).toBeFalsy()

        // Toggle transcription ON
        transcriptionSwitch.selected = true
        transcriptionSwitch.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(transcriptionSwitch.disabled).toBe(true)
        })
        expect(transcriptionSwitch.selected).toBe(false)

        // Hint should display WebGPU unsupported message with error style
        const hintEl = shadowQuery(el, '.settings-hint')!
        expect(hintEl.classList.contains('error')).toBe(true)
        expect(hintEl.textContent?.trim()).toBe(
            'Transcription is not available because your browser does not support WebGPU.',
        )

        // Should not have sent start-model-download message
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'start-model-download' })
    })

    test('disables transcription switch and shows unsupported message when shader-f16 is not supported on toggle', async () => {
        mockCheckWebGPUSupport.mockResolvedValueOnce({ supported: false, reason: 'no-shader-f16' })
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        expect(transcriptionSwitch).not.toBeNull()

        // Toggle transcription ON
        transcriptionSwitch.selected = true
        transcriptionSwitch.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(transcriptionSwitch.disabled).toBe(true)
        })
        expect(transcriptionSwitch.selected).toBe(false)

        // Hint should display shader-f16 unsupported message with error style
        const hintEl = shadowQuery(el, '.settings-hint')!
        expect(hintEl.classList.contains('error')).toBe(true)
        expect(hintEl.textContent?.trim()).toBe(
            'Transcription is not available because your browser or GPU does not support WebGPU shader-f16.',
        )

        // Should not have sent start-model-download message
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'start-model-download' })
    })

    test('starts model download when WebGPU and shader-f16 are supported on toggle', async () => {
        mockCheckWebGPUSupport.mockResolvedValueOnce({ supported: true })
        mockHasCache.mockResolvedValueOnce(false)
        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        expect(transcriptionSwitch).not.toBeNull()

        // Toggle transcription ON
        transcriptionSwitch.selected = true
        transcriptionSwitch.dispatchEvent(new Event('input'))
        await elementUpdated(el)

        // Should have sent start-model-download message
        await vi.waitFor(() => {
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'start-model-download' })
        })

        // Switch should not be disabled after toggle operation completes
        await vi.waitFor(() => {
            expect(transcriptionSwitch.disabled).toBe(false)
        })
    })

    test('invalidates stale ON handler when toggled OFF before cache check completes', async () => {
        let resolveCacheCheck!: (value: boolean) => void
        mockCheckWebGPUSupport.mockResolvedValueOnce({ supported: true })
        mockHasCache.mockImplementationOnce(
            () =>
                new Promise<boolean>(resolve => {
                    resolveCacheCheck = resolve
                }),
        )

        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        expect(transcriptionSwitch).not.toBeNull()

        // Toggle ON (initiates WebGPU check and then hangs on hasCache())
        transcriptionSwitch.selected = true
        transcriptionSwitch.dispatchEvent(new Event('input'))
        await elementUpdated(el)

        // Switch is locked while operation is pending
        expect(transcriptionSwitch.disabled).toBe(true)

        // User quickly toggles OFF before cache check resolves
        transcriptionSwitch.selected = false
        transcriptionSwitch.dispatchEvent(new Event('input'))
        await elementUpdated(el)

        // Now resolve the stale hasCache() call with false (which would normally trigger model download)
        resolveCacheCheck(false)
        await elementUpdated(el)

        // Stale handler must have been invalidated: start-model-download should not be called
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'start-model-download' })

        // Config should remain disabled
        const config = Settings.getConfiguration()
        expect(config.transcription.enabled).toBe(false)
    })

    test('detects cache inconsistency and shows redownload warning when transcription is enabled but cache is missing', async () => {
        mockHasCache.mockResolvedValue(false)
        const config = Settings.getConfiguration()
        config.transcription.enabled = true
        Settings.setConfiguration(config)

        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            const hintEl = shadowQuery(el, '.settings-hint')!
            expect(hintEl.classList.contains('error')).toBe(true)
            expect(hintEl.textContent?.trim()).toBe(
                'Model data is missing or corrupted. Please toggle transcription off and on again to redownload the model.',
            )
        })

        // Switch remains enabled (selected)
        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        expect(transcriptionSwitch.selected).toBe(true)
    })

    test('clears cache inconsistency warning when user toggles transcription off', async () => {
        mockHasCache.mockResolvedValue(false)
        const config = Settings.getConfiguration()
        config.transcription.enabled = true
        Settings.setConfiguration(config)

        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings') as any
        await elementUpdated(el)

        await vi.waitFor(() => {
            expect(el.hasCacheInconsistency).toBe(true)
        })

        // Toggle OFF
        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        transcriptionSwitch.selected = false
        transcriptionSwitch.dispatchEvent(new Event('input'))
        await elementUpdated(el)

        await vi.waitFor(() => {
            expect(el.hasCacheInconsistency).toBe(false)
            expect(mockClear).toHaveBeenCalled()
        })

        const hintEl = shadowQuery(el, '.settings-hint')!
        expect(hintEl.classList.contains('error')).toBe(false)
    })

    test('re-checks cache consistency on setTabActive(true)', async () => {
        mockHasCache.mockResolvedValue(true)
        const config = Settings.getConfiguration()
        config.transcription.enabled = true
        Settings.setConfiguration(config)

        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings') as any
        await elementUpdated(el)

        expect(el.hasCacheInconsistency).toBe(false)

        // Cache disappears while tab was inactive
        mockHasCache.mockResolvedValue(false)

        await el.setTabActive(true)
        await elementUpdated(el)

        expect(el.hasCacheInconsistency).toBe(true)
    })

    test('does not set hasCacheInconsistency if transcription is toggled off while checkCacheConsistency is pending', async () => {
        let resolveHasCache!: (val: boolean) => void
        mockHasCache.mockImplementation(
            () =>
                new Promise(resolve => {
                    resolveHasCache = resolve
                }),
        )

        const config = Settings.getConfiguration()
        config.transcription.enabled = true
        Settings.setConfiguration(config)

        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings') as any
        await elementUpdated(el)

        // Start pending checkCacheConsistency
        const checkPromise = el.checkCacheConsistency()

        // User toggles transcription OFF while check is pending
        const transcriptionSwitch = shadowQuery(el, '#transcription') as any
        transcriptionSwitch.selected = false
        transcriptionSwitch.dispatchEvent(new Event('input'))
        await elementUpdated(el)

        // Resolve hasCache with false (model missing) after OFF toggle
        resolveHasCache(false)
        await checkPromise
        await elementUpdated(el)

        expect(el.hasCacheInconsistency).toBe(false)
        const hintEl = shadowQuery(el, '.settings-hint')!
        expect(hintEl.classList.contains('error')).toBe(false)
    })

    test('scrolls to transcription switch when hash is #transcription', async () => {
        history.replaceState(null, '', '?tab=settings#transcription')

        const screen = render(html`<extension-settings></extension-settings>`)
        const el = screen.container.querySelector('extension-settings')!
        await elementUpdated(el)

        const switchEl = shadowQuery(el, '#transcription')!
        const scrollSpy = vi.spyOn(switchEl, 'scrollIntoView').mockImplementation(() => {})

        await (el as any).checkAnchorNavigation()

        await vi.waitFor(() => {
            expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
        })

        history.replaceState(null, '', window.location.pathname)
    })
})
