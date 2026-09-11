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

function waitForHashChange(timeoutMs = 1000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener('hashchange', onHashChange)
            reject(new Error(`Timeout waiting for hashchange event (${timeoutMs}ms)`))
        }, timeoutMs)
        const onHashChange = () => {
            clearTimeout(timer)
            resolve()
        }
        window.addEventListener('hashchange', onHashChange, { once: true })
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

    describe('hash handling', () => {
        afterEach(() => {
            history.replaceState(null, '', window.location.pathname + window.location.search)
        })

        test('activates Settings tab when hash is #settings', async () => {
            history.replaceState(null, '', '#settings')
            const el = renderTab()
            await elementUpdated(el)

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            const mainPanel = shadowQuery(el, '#panel-main')

            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)
            expect(mainPanel?.hasAttribute('hidden')).toBe(true)
        })

        test('activates Cropping tab when hash is #cropping', async () => {
            history.replaceState(null, '', '#cropping')
            const el = renderTab()
            await elementUpdated(el)

            const croppingTab = shadowQuery(el, '#tab-cropping')
            const croppingPanel = shadowQuery(el, '#panel-cropping')
            const mainPanel = shadowQuery(el, '#panel-main')

            expect(croppingTab?.hasAttribute('active')).toBe(true)
            expect(croppingPanel?.hasAttribute('hidden')).toBe(false)
            expect(mainPanel?.hasAttribute('hidden')).toBe(true)
        })

        test('activates Support tab when hash is #support', async () => {
            history.replaceState(null, '', '#support')
            const el = renderTab()
            await elementUpdated(el)

            const supportTab = shadowQuery(el, '#tab-support')
            const supportPanel = shadowQuery(el, '#panel-support')
            const mainPanel = shadowQuery(el, '#panel-main')

            expect(supportTab?.hasAttribute('active')).toBe(true)
            expect(supportPanel?.hasAttribute('hidden')).toBe(false)
            expect(mainPanel?.hasAttribute('hidden')).toBe(true)
        })

        test('activates corresponding tab with case-insensitive hash e.g. #SETTINGS', async () => {
            history.replaceState(null, '', '#SETTINGS')
            const el = renderTab()
            await elementUpdated(el)

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('defaults to first tab and clears hash when hash is only #', async () => {
            history.replaceState(null, '', window.location.pathname + window.location.search + '#')
            const el = renderTab()
            await elementUpdated(el)

            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
            expect(window.location.hash).toBe('')
        })

        test('displays first tab and has no back history when opened with undefined hash in a new tab', async () => {
            // In a fresh tab session, there is no back history yet
            if ((window as any).navigation) {
                expect((window as any).navigation.canGoBack).toBe(false)
            }

            // Set undefined hash on current page (simulating opening option page with undefined hash in a fresh tab)
            history.replaceState(null, '', '#unknown')
            expect(window.location.hash).toBe('#unknown')

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

            // The undefined hash should be cleared
            expect(window.location.hash).toBe('')

            // Verify no history entry was added and replaceState was used
            expect(pushStateSpy).not.toHaveBeenCalled()
            expect(replaceStateSpy).toHaveBeenCalledWith(null, '', window.location.pathname + window.location.search)
            expect(history.length).toBe(lengthBefore)

            // There should be no back history in this tab
            if ((window as any).navigation) {
                expect((window as any).navigation.canGoBack).toBe(false)
            }

            pushStateSpy.mockRestore()
            replaceStateSpy.mockRestore()
        })

        test('updates hash when switching tabs and removes hash for first tab', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement
            const croppingTab = shadowQuery(el, '#tab-cropping') as HTMLElement
            const supportTab = shadowQuery(el, '#tab-support') as HTMLElement
            const mainTab = shadowQuery(el, '#tab-main') as HTMLElement

            // Switch to Settings
            tabs.activeTab = settingsTab
            expect(window.location.hash).toBe('#settings')

            // Switch to Cropping
            tabs.activeTab = croppingTab
            expect(window.location.hash).toBe('#cropping')

            // Switch to Support
            tabs.activeTab = supportTab
            expect(window.location.hash).toBe('#support')

            // Switch back to Records (first tab)
            tabs.activeTab = mainTab
            expect(window.location.hash).toBe('')
        })

        test('switches tab on hashchange event', async () => {
            const el = renderTab()
            await elementUpdated(el)

            // Change hash to #settings
            const hashChangeToSettings = waitForHashChange()
            window.location.hash = '#settings'
            await hashChangeToSettings
            await elementUpdated(el)

            const settingsTab = shadowQuery(el, '#tab-settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab?.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // Dispatch hashchange back to empty (first tab)
            history.replaceState(null, '', window.location.pathname + window.location.search)
            window.dispatchEvent(new HashChangeEvent('hashchange'))
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
            expect(window.location.hash).toBe('#settings')

            tabs.activeTab = croppingTab
            expect(window.location.hash).toBe('#cropping')

            tabs.activeTab = supportTab
            expect(window.location.hash).toBe('#support')

            // History back -> #cropping
            let hashChange = waitForHashChange()
            history.back()
            await hashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('#cropping')
            const croppingPanel = shadowQuery(el, '#panel-cropping')
            expect(croppingTab.hasAttribute('active')).toBe(true)
            expect(croppingPanel?.hasAttribute('hidden')).toBe(false)

            // History back -> #settings
            hashChange = waitForHashChange()
            history.back()
            await hashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('#settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // History back -> empty (records)
            hashChange = waitForHashChange()
            history.back()
            await hashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('')
            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)

            // History forward -> #settings
            hashChange = waitForHashChange()
            history.forward()
            await hashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('#settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // History forward -> #cropping
            hashChange = waitForHashChange()
            history.forward()
            await hashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('#cropping')
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
            expect(window.location.hash).toBe('#settings')

            // Switch to 1st tab (removes hash via pushState)
            tabs.activeTab = mainTab
            expect(window.location.hash).toBe('')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)

            // History back -> #settings
            const backHashChange = waitForHashChange()
            history.back()
            await backHashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('#settings')
            const settingsPanel = shadowQuery(el, '#panel-settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
            expect(settingsPanel?.hasAttribute('hidden')).toBe(false)

            // History forward -> empty (records)
            const forwardHashChange = waitForHashChange()
            history.forward()
            await forwardHashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('')
            expect(mainTab.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
        })

        test('displays first tab and does not leave undefined hash in history when changing hash on already opened page', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement

            // Set up an established history entry: switch to #settings
            tabs.activeTab = settingsTab
            expect(window.location.hash).toBe('#settings')

            // User/browser changes hash to an undefined hash on the opened page
            const hashChange = waitForHashChange()
            window.location.hash = '#undefined-tab'
            await hashChange
            await elementUpdated(el)

            // 1st tab should be displayed, and the undefined hash should be replaced (cleared)
            const mainTab = shadowQuery(el, '#tab-main')
            const mainPanel = shadowQuery(el, '#panel-main')
            expect(mainTab?.hasAttribute('active')).toBe(true)
            expect(mainPanel?.hasAttribute('hidden')).toBe(false)
            expect(window.location.hash).toBe('')

            // Undefined hash must not remain in history:
            // Going back should directly return to #settings, NOT #undefined-tab
            const backHashChange = waitForHashChange()
            history.back()
            await backHashChange
            await elementUpdated(el)

            expect(window.location.hash).toBe('#settings')
            expect(settingsTab.hasAttribute('active')).toBe(true)
        })

        test('does not duplicate history entries when selecting the already active tab', async () => {
            const el = renderTab()
            await elementUpdated(el)

            const tabs = shadowQuery(el, 'md-tabs') as any
            const settingsTab = shadowQuery(el, '#tab-settings') as HTMLElement

            tabs.activeTab = settingsTab
            expect(window.location.hash).toBe('#settings')

            const lengthBefore = history.length

            // Trigger change on the same tab
            tabs.dispatchEvent(new Event('change'))
            await elementUpdated(el)

            expect(window.location.hash).toBe('#settings')
            expect(history.length).toBe(lengthBefore)
        })
    })
})
