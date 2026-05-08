import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'

// Mock sentry to avoid process.env references in browser
vi.mock('../../src/sentry', () => ({
    sendException: vi.fn(),
    sendFeedback: vi.fn(() => true),
    sendEvent: vi.fn(),
    FeedbackType: {},
}))

import '../../src/element/support'
import '../../src/element/alert'

describe('extension-support', () => {
    test('renders review section with Chrome Web Store link', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const reviewHeading = headings.find(h => h.textContent?.trim() === 'Review')
        expect(reviewHeading).not.toBeUndefined()

        const reviewBtn = shadowQuery(el, '.review-section md-filled-tonal-button')
        expect(reviewBtn?.textContent?.trim()).toContain('Write a Review')
        expect(reviewBtn?.getAttribute('href')).toContain('chromewebstore.google.com')
    })

    test('renders support section with Buy Me a Coffee link', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const link = shadowQuery<HTMLAnchorElement>(el, '.buymeacoffee-link')
        expect(link).not.toBeNull()
        expect(link?.getAttribute('href')).toContain('buymeacoffee.com')
    })

    test('renders feedback section with heading', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const feedbackHeading = headings.find(h => h.textContent?.trim() === 'Feedback')
        expect(feedbackHeading).not.toBeUndefined()
    })

    test('renders feedback form with type selector', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const select = shadowQuery(el, '.feedback-form md-filled-select')
        expect(select).not.toBeNull()
    })

    test('renders feedback form with message textarea', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const textField = shadowQuery(el, '.feedback-form md-filled-text-field')
        expect(textField).not.toBeNull()
        expect(textField?.getAttribute('type')).toBe('textarea')
    })

    test('renders character count display', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const charCount = shadowQuery(el, '.char-count')
        expect(charCount).not.toBeNull()
        // Default: 0 characters
        expect(charCount?.textContent).toContain('0')
        expect(charCount?.textContent).toContain('1000')
    })

    test('renders bug tracking switch', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const bugTrackingLabel = shadowQueryAll(el, 'label').find(l => l.textContent?.includes('Bug Tracking'))
        expect(bugTrackingLabel).not.toBeUndefined()

        const switchEl = shadowQuery(el, 'md-switch')
        expect(switchEl).not.toBeNull()
    })

    test('renders send feedback button', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const sendBtn = shadowQuery(el, '.feedback-form md-filled-tonal-button')
        expect(sendBtn).not.toBeNull()
        expect(sendBtn?.textContent?.trim()).toContain('Send Feedback')
    })

    test('renders Support Development section', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const supportHeading = headings.find(h => h.textContent?.trim() === 'Support Development')
        expect(supportHeading).not.toBeUndefined()
    })

    describe('open source licenses button', () => {
        let alertEl: HTMLElement

        afterEach(() => {
            vi.unstubAllGlobals()
            alertEl?.remove()
        })

        test('renders license section with button', async () => {
            const screen = render(html`<extension-support></extension-support>`)
            const el = screen.container.querySelector('extension-support')!
            await elementUpdated(el)

            const headings = shadowQueryAll(el, 'h2')
            const licenseHeading = headings.find(h => h.textContent?.trim() === 'License Information')
            expect(licenseHeading).not.toBeUndefined()

            // License heading should appear before Review heading
            const headingTexts = headings.map(h => h.textContent?.trim())
            const licenseIdx = headingTexts.indexOf('License Information')
            const reviewIdx = headingTexts.indexOf('Review')
            expect(licenseIdx).toBeLessThan(reviewIdx)
        })

        test('opens alert modal with license content on button click', async () => {
            const licenseContent = '# Licenses\n\nMIT License\n\nCopyright (c) 2024'
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(licenseContent),
            })
            vi.stubGlobal('fetch', fetchMock)

            alertEl = document.createElement('extension-alert')
            alertEl.id = 'alert-dialog'
            document.body.appendChild(alertEl)

            const screen = render(html`<extension-support></extension-support>`)
            const el = screen.container.querySelector('extension-support')!
            await elementUpdated(el)

            // Find and click the license button (first md-filled-tonal-button without href)
            const buttons = shadowQueryAll<HTMLElement>(el, 'md-filled-tonal-button')
            const licenseBtn = buttons.find(
                b => !b.hasAttribute('href') && b.textContent?.includes('Open Source Licenses'),
            )
            expect(licenseBtn).not.toBeUndefined()
            licenseBtn!.click()

            await vi.waitFor(() => {
                expect(fetchMock).toHaveBeenCalledWith('dist/dependencies-licenses.md')
                const dialog = alertEl.shadowRoot?.querySelector('md-dialog') as
                    | (HTMLElement & { open?: boolean })
                    | null
                expect(dialog).not.toBeNull()
                expect(dialog?.open).toBe(true)
                const headline = alertEl.shadowRoot?.querySelector('[slot="headline"]')
                expect(headline?.textContent).toBe('Open Source Licenses')
                const content = alertEl.shadowRoot?.querySelector('[slot="content"] pre')
                expect(content).not.toBeNull()
                expect(content?.textContent).toBe(licenseContent)
            })
        })

        test('shows error message when license fetch fails', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            })
            vi.stubGlobal('fetch', fetchMock)

            alertEl = document.createElement('extension-alert')
            alertEl.id = 'alert-dialog'
            document.body.appendChild(alertEl)

            const screen = render(html`<extension-support></extension-support>`)
            const el = screen.container.querySelector('extension-support')!
            await elementUpdated(el)

            const buttons = shadowQueryAll<HTMLElement>(el, 'md-filled-tonal-button')
            const licenseBtn = buttons.find(
                b => !b.hasAttribute('href') && b.textContent?.includes('Open Source Licenses'),
            )
            licenseBtn!.click()

            await vi.waitFor(() => {
                expect(fetchMock).toHaveBeenCalledWith('dist/dependencies-licenses.md')
                const dialog = alertEl.shadowRoot?.querySelector('md-dialog') as
                    | (HTMLElement & { open?: boolean })
                    | null
                expect(dialog).not.toBeNull()
                expect(dialog?.open).toBe(true)
                const content = alertEl.shadowRoot?.querySelector('[slot="content"]')
                expect(content?.textContent).toContain('Failed to load license information.')
            })
        })
    })
})
