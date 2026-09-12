import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, afterEach } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'
import '../../src/element/tab'
import type { OptionTab } from '../../src/element/tab'

function renderTab() {
    const screen = render(html`<option-tab></option-tab>`)
    return screen.container.querySelector('option-tab') as OptionTab
}

function waitForPopState(timeoutMs = 1000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener('popstate', onPopState)
            reject(new Error(`Timeout waiting for popstate event (${timeoutMs}ms)`))
        }, timeoutMs)
        const onPopState = () => {
            clearTimeout(timer)
            resolve()
        }
        window.addEventListener('popstate', onPopState, { once: true })
    })
}

describe('option-tab', () => {
    test('renders 4 primary tabs', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const tabs = shadowQueryAll(el, 'md-primary-tab')
        expect(tabs.length).toBe(4)
    })

    test('tab labels contain Records, Settings, Cropping, Support', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const tabs = shadowQueryAll(el, 'md-primary-tab')
        const texts = tabs.map(t => t.textContent ?? '')
        expect(texts.some(t => t.includes('Records'))).toBe(true)
        expect(texts.some(t => t.includes('Settings'))).toBe(true)
        expect(texts.some(t => t.includes('Cropping'))).toBe(true)
        expect(texts.some(t => t.includes('Support'))).toBe(true)
    })

    test('first tab (Records) is active by default', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const firstTab = shadowQuery(el, '#tab-main')
        expect(firstTab?.hasAttribute('active')).toBe(true)
    })

    test('renders 4 tab panels with correct IDs and aria attributes', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const panels = shadowQueryAll(el, '[role="tabpanel"]')
        expect(panels.length).toBe(4)

        const panelIds = panels.map(p => p.id)
        expect(panelIds).toContain('panel-main')
        expect(panelIds).toContain('panel-settings')
        expect(panelIds).toContain('panel-cropping')
        expect(panelIds).toContain('panel-support')
    })

    test('non-active panels are hidden', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const mainPanel = shadowQuery(el, '#panel-main')
        const settingsPanel = shadowQuery(el, '#panel-settings')
        const croppingPanel = shadowQuery(el, '#panel-cropping')
        const supportPanel = shadowQuery(el, '#panel-support')

        expect(mainPanel?.hasAttribute('hidden')).toBe(false)
        expect(settingsPanel?.hasAttribute('hidden')).toBe(true)
        expect(croppingPanel?.hasAttribute('hidden')).toBe(true)
        expect(supportPanel?.hasAttribute('hidden')).toBe(true)
    })

    test('each panel has a slot for content projection', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const slots = shadowQueryAll<HTMLSlotElement>(el, 'slot')
        const slotNames = slots.map(s => s.name)
        expect(slotNames).toContain('panel-main')
        expect(slotNames).toContain('panel-settings')
        expect(slotNames).toContain('panel-cropping')
        expect(slotNames).toContain('panel-support')
    })

    describe('tab query param handling', () => {
        afterEach(() => {
            history.replaceState(null, '', window.location.pathname)
        })

        test('activates Settings tab when tab param is settings', async () => {
            history.replaceState(null, '', '?tab=settings')
            const el = renderTab()
            await elementUpdated(el)

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            const mainPanel = shadowQuery(el, '#panel-main')

            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)
            expect(mainPanel?.hasAttribute('hidden')).toBe(true)
        })

        test('activates Cropping tab when tab param is cropping', async () => {
            history.replaceState(null, '', '?tab=cropping')
            const el = renderTab()
            await elementUpdated(el)

            const croppingTab = shadowQuery(el, '#tab-cropping')
            const croppingPanel = shadowQuery(el, '#panel-cropping')
            const mainPanel = shadowQuery(el, '#panel-main')

            expect(croppingTab?.hasAttribute('active')).toBe(true)
            expect(croppingPanel?.hasAttribute('hidden')).toBe(false)
            expect(mainPanel?.hasAttribute('hidden')).toBe(true)
        })

        test('activates Support tab when tab param is support', async () => {
            history.replaceState(null, '', '?tab=support')
            const el = renderTab()
            await elementUpdated(el)

            const supportTab = shadowQuery(el, '#tab-support')
            const supportPanel = shadowQuery(el, '#panel-support')
            const mainPanel = shadowQuery(el, '#panel-main')

            expect(supportTab?.hasAttribute('active')).toBe(true)
            expect(supportPanel?.hasAttribute('hidden')).toBe(false)
            expect(mainPanel?.hasAttribute('hidden')).toBe(true)
        })

        test('activates corresponding tab with case-insensitive tab param e.g. ?tab=SETTINGS', async () => {
            history.replaceState(null, '', '?tab=SETTINGS')
            const el = renderTab()
            await elementUpdated(el)

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('activates Records tab when tab param is records', async () => {
            history.replaceState(null, '', '?tab=records')
            const el = renderTab()
            await elementUpdated(el)

            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('displays first tab and has no back history when opened with undefined tab in a new tab', async () => {
            // In a fresh tab session, there is no back history yet
            if ((window as any).navigation) {
                expect((window as any).navigation.canGoBack).toBe(false)
            }

            history.replaceState(null, '', '?tab=unknown')
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('unknown')

            const pushStateSpy = vi.spyOn(history, 'pushState')
            const replaceStateSpy = vi.spyOn(history, 'replaceState')
            const lengthBefore = history.length

            const el = renderTab()
            await elementUpdated(el)

            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')

            // 1st tab should be displayed
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)

            // The undefined tab query param should be cleared
            expect(new URLSearchParams(window.location.search).get('tab')).toBeNull()

            // Verify no history entry was added and replaceState was used
            expect(pushStateSpy).not.toHaveBeenCalled()
            expect(replaceStateSpy).toHaveBeenCalledWith(null, '', window.location.pathname)
            expect(history.length).toBe(lengthBefore)

            // There should be no back history in this tab
            if ((window as any).navigation) {
                expect((window as any).navigation.canGoBack).toBe(false)
            }

            pushStateSpy.mockRestore()
            replaceStateSpy.mockRestore()
        })

        test('updates tab query param when switching tabs and removes tab param for first tab', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement
            const croppingTab = shadowQuery(el, '#tab-cropping') as HTMLElement
            const supportTab = shadowQuery(el, '#tab-support') as HTMLElement
            const mainTab = shadowQuery(el, '#tab-main') as HTMLElement

            // Switch to Settings
            tabs.activeTab = settingsTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')

            // Switch to Cropping
            tabs.activeTab = croppingTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('cropping')

            // Switch to Support
            tabs.activeTab = supportTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('support')

            // Switch back to Records (first tab)
            tabs.activeTab = mainTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBeNull()
            expect(window.location.search).toBe('')
        })

        test('clears hash when switching tabs, but retains hash when navigating back in history', async () => {
            history.replaceState(null, '', '?tab=settings#transcription')
            const el = renderTab()
            await elementUpdated(el)

            expect(window.location.hash).toBe('#transcription')
            expect(window.location.href).toContain('#transcription')

            const tabs = shadowQuery(el, 'md-tabs') as any
            const croppingTab = shadowQuery(el, '#tab-cropping') as HTMLElement

            // Switch to Cropping: hash should be removed
            tabs.activeTab = croppingTab
            tabs.dispatchEvent(new Event('change'))
            await elementUpdated(el)

            expect(window.location.hash).toBe('')
            expect(window.location.href).not.toContain('#')
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('cropping')

            // Navigate back in history: should return to settings tab with #transcription retained
            let popState = waitForPopState()
            history.back()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')
            expect(window.location.hash).toBe('#transcription')
            expect(window.location.href).toContain('#transcription')

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // Navigate forward in history: should return to cropping tab without hash
            popState = waitForPopState()
            history.forward()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('cropping')
            expect(window.location.hash).toBe('')
            expect(window.location.href).not.toContain('#')
        })

        test('switches tab on popstate event', async () => {
            const el = renderTab()
            await elementUpdated(el)

            // Change url to ?tab=settings
            history.pushState(null, '', '?tab=settings')
            window.dispatchEvent(new PopStateEvent('popstate'))
            await elementUpdated(el)

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // Dispatch popstate back to empty (first tab)
            history.pushState(null, '', window.location.pathname)
            window.dispatchEvent(new PopStateEvent('popstate'))
            await elementUpdated(el)

            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('navigates backward and forward in history', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement
            const croppingTab = shadowQuery(el, '#tab-cropping') as HTMLElement
            const supportTab = shadowQuery(el, '#tab-support') as HTMLElement

            // Switch tabs: records -> settings -> cropping -> support
            tabs.activeTab = settingsTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')

            tabs.activeTab = croppingTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('cropping')

            tabs.activeTab = supportTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('support')

            // History back -> ?tab=cropping
            let popState = waitForPopState()
            history.back()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('cropping')
            const croppingPanel = shadowQuery(el, '#panel-cropping')
            expect(croppingTab.hasAttribute('active')).toBe(true)
            expect(croppingPanel?.hasAttribute('hidden')).toBe(false)

            // History back -> ?tab=settings
            popState = waitForPopState()
            history.back()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // History back -> empty (records)
            popState = waitForPopState()
            history.back()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBeNull()
            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)

            // History forward -> ?tab=settings
            popState = waitForPopState()
            history.forward()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // History forward -> ?tab=cropping
            popState = waitForPopState()
            history.forward()
            await popState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('cropping')
            expect(croppingTab.hasAttribute('active')).toBe(true)
            expect(croppingPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('pushes history and allows back navigation when switching back to the first tab (records)', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement
            const mainTab = shadowQuery(el, '#tab-main') as HTMLElement

            tabs.activeTab = settingsTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')

            // Switch to 1st tab (removes tab param via pushState)
            tabs.activeTab = mainTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBeNull()
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)

            // History back -> ?tab=settings
            const backPopState = waitForPopState()
            history.back()
            await backPopState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // History forward -> empty (records)
            const forwardPopState = waitForPopState()
            history.forward()
            await forwardPopState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBeNull()
            expect(mainTab.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('displays first tab and does not leave undefined tab in history when changing query on already opened page', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement

            // Set up an established history entry: switch to settings
            tabs.activeTab = settingsTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')

            // User/browser changes query to an undefined tab on the opened page
            history.pushState(null, '', '?tab=undefined-tab')
            window.dispatchEvent(new PopStateEvent('popstate'))
            await elementUpdated(el)

            // 1st tab should be displayed, and the undefined tab should be replaced (cleared)
            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
            expect(new URLSearchParams(window.location.search).get('tab')).toBeNull()

            // Undefined tab must not remain in history:
            // Going back should directly return to ?tab=settings, NOT ?tab=undefined-tab
            const backPopState = waitForPopState()
            history.back()
            await backPopState
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
        })

        test('does not duplicate history entries when selecting the already active tab', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement

            tabs.activeTab = settingsTab
            tabs.dispatchEvent(new Event('change'))
            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')

            const lengthBefore = history.length

            // Trigger change on the same tab
            tabs.dispatchEvent(new Event('change'))
            await elementUpdated(el)

            expect(new URLSearchParams(window.location.search).get('tab')).toBe('settings')
            expect(history.length).toBe(lengthBefore)
        })

        test('notifies settings tab when switching to settings tab', async () => {
            const setTabActiveSpy = vi.fn()
            const mockSettings = document.createElement('div') as any
            mockSettings.setTabActive = setTabActiveSpy
            document.body.appendChild(mockSettings)

            vi.spyOn(customElements, 'whenDefined').mockResolvedValue(undefined as any)
            vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
                if (selector === 'extension-settings') return mockSettings
                return null
            })

            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement

            tabs.activeTab = settingsTab
            tabs.dispatchEvent(new Event('change'))
            await elementUpdated(el)

            await vi.waitFor(() => {
                expect(setTabActiveSpy).toHaveBeenCalledWith(true)
            })

            mockSettings.remove()
            vi.restoreAllMocks()
        })
    })
})
