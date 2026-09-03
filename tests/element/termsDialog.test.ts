import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'

vi.mock('../../src/sentry', () => ({
    sendEvent: vi.fn(),
}))

import { sendEvent } from '../../src/sentry'
import '../../src/element/termsDialog'
import type TermsDialog from '../../src/element/termsDialog'
import { Settings } from '../../src/element/settings'
import { Configuration } from '../../src/configuration'

describe('extension-terms-dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Reset configuration in LocalStorage before each test
        const config = new Configuration()
        config.hasAgreedTerms = false
        Settings.setConfiguration(config)
    })

    test('renders md-dialog with Terms of Service headline', async () => {
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')!
        await elementUpdated(el)

        const headline = shadowQuery(el, '[slot="headline"]')
        expect(headline?.textContent?.trim()).toBe('Terms of Service')
    })

    test('renders description with link to terms of service', async () => {
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')!
        await elementUpdated(el)

        const link = shadowQuery(el, '#form a')
        expect(link).not.toBeNull()
        expect(link?.textContent?.trim()).toBe('Terms of Service')
        expect(link?.getAttribute('href')).toBe('https://recorder.appcloud.info/TERMS.html')
        expect(link?.getAttribute('target')).toBe('_blank')
        expect(link?.getAttribute('rel')).toBe('noopener')
    })

    test('renders OK button', async () => {
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')!
        await elementUpdated(el)

        const button = shadowQuery(el, 'md-filled-tonal-button[value="ok"]')
        expect(button).not.toBeNull()
        expect(button?.textContent?.trim()).toBe('OK')
    })

    test('prevents dialog cancel event (backdrop / escape)', async () => {
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')! as TermsDialog
        await elementUpdated(el)

        const dialog = el.getDialog()!
        dialog.show()
        await elementUpdated(el)

        // Dispatch cancel event (such as from clicking backdrop or pressing Escape)
        const cancelEvent = new Event('cancel', { cancelable: true })
        dialog.dispatchEvent(cancelEvent)

        expect(cancelEvent.defaultPrevented).toBe(true)
    })

    test('prevents dialog close event before OK is clicked', async () => {
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')! as TermsDialog
        await elementUpdated(el)

        const dialog = el.getDialog()!
        dialog.show()
        await elementUpdated(el)

        // Attempting to close dialog directly should be prevented
        const closeEvent = new Event('close', { cancelable: true })
        dialog.dispatchEvent(closeEvent)

        expect(closeEvent.defaultPrevented).toBe(true)
    })

    test('clicking OK saves hasAgreedTerms and closes the dialog', async () => {
        const syncSpy = vi.spyOn(Settings, 'syncConfiguration').mockResolvedValue()
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')! as TermsDialog
        await elementUpdated(el)

        const dialog = el.getDialog()!
        dialog.show()
        await elementUpdated(el)

        const okBtn = shadowQuery(el, 'md-filled-tonal-button[value="ok"]') as HTMLElement
        okBtn.click()
        await elementUpdated(el)

        const config = Settings.getConfiguration()
        expect(config.hasAgreedTerms).toBe(true)
        expect(syncSpy).toHaveBeenCalled()
        expect(sendEvent).toHaveBeenCalledWith({ type: 'agree_terms' })

        syncSpy.mockRestore()
    })

    test('does not show dialog if hasAgreedTerms is already true', async () => {
        const config = new Configuration()
        config.hasAgreedTerms = true
        Settings.setConfiguration(config)

        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')! as TermsDialog
        await elementUpdated(el)

        const dialog = el.getDialog()!
        expect(dialog.open).toBe(false)
    })

    test('closes dialog when config change event indicates hasAgreedTerms is true', async () => {
        const screen = render(html`<extension-terms-dialog></extension-terms-dialog>`)
        const el = screen.container.querySelector('extension-terms-dialog')! as TermsDialog
        await elementUpdated(el)

        const dialog = el.getDialog()!
        dialog.show()
        await elementUpdated(el)
        expect(dialog.open).toBe(true)

        const closedPromise = new Promise(resolve => dialog.addEventListener('closed', resolve, { once: true }))
        // Simulate agreement in another tab or component
        const config = Settings.getConfiguration()
        config.hasAgreedTerms = true
        Settings.setConfiguration(config)
        await closedPromise

        expect(dialog.open).toBe(false)
    })
})
