import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'
import { getChromeMock, getMessageListenersCount } from './test-setup'
import '../../src/element/cropping'
import type { Cropping } from '../../src/element/cropping'

describe('extension-cropping', () => {
    test('renders "Cropping" heading', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const heading = shadowQuery(el, 'h2')
        expect(heading?.textContent?.trim()).toBe('Cropping')
    })

    test('renders enable/disable cropping switch', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const switchEl = shadowQuery(el, '.switch-label md-switch')
        expect(switchEl).not.toBeNull()

        const label = shadowQuery(el, '.switch-label')
        expect(label?.textContent?.trim()).toBe('Enable Cropping')
    })

    test('renders region input fields (X, Y, Width, Height)', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const inputs = shadowQueryAll(el, '.region-inputs md-filled-text-field')
        expect(inputs.length).toBe(4)

        const labels = inputs.map(i => i.getAttribute('label'))
        expect(labels).toContain('X')
        expect(labels).toContain('Y')
        expect(labels).toContain('Width')
        expect(labels).toContain('Height')
    })

    test('renders cropping-preview component', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const preview = shadowQuery(el, 'cropping-preview')
        expect(preview).not.toBeNull()
    })

    test('connectedCallback registers chrome.runtime.onMessage listener', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        expect(getMessageListenersCount()).toBeGreaterThan(0)
    })

    test('connectedCallback sends request-recording-state message', async () => {
        const mock = getChromeMock()
        render(html`<extension-cropping></extension-cropping>`)

        // Wait for async requestRecordingState to send
        await vi.waitFor(() => {
            expect(mock.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'request-recording-state' }),
            )
        })
    })

    test('disconnectedCallback removes message listener', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const countBefore = getMessageListenersCount()
        el.remove()
        expect(getMessageListenersCount()).toBeLessThan(countBefore)
    })

    test('renders Preview heading and hint text', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h3')
        const previewHeading = headings.find(h => h.textContent?.trim() === 'Preview')
        expect(previewHeading).not.toBeUndefined()

        const hint = shadowQuery(el, '.hint')
        expect(hint?.textContent).toContain('Adjust the cropping area')
    })

    test('renders Region heading', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h3')
        const regionHeading = headings.find(h => h.textContent?.trim() === 'Region')
        expect(regionHeading).not.toBeUndefined()
    })

    test('region input fields have correct number attributes', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const inputs = shadowQueryAll(el, '.region-inputs md-filled-text-field')
        for (const input of inputs) {
            expect(input.getAttribute('type')).toBe('number')
            expect(input.getAttribute('suffix-text')).toBe('px')
        }
    })

    test('X and Y inputs have step=2 (even numbers constraint)', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')!
        await elementUpdated(el)

        const xInput = shadowQueryAll(el, '.region-inputs md-filled-text-field').find(
            i => i.getAttribute('label') === 'X',
        )
        const yInput = shadowQueryAll(el, '.region-inputs md-filled-text-field').find(
            i => i.getAttribute('label') === 'Y',
        )

        expect(xInput?.getAttribute('step')).toBe('2')
        expect(yInput?.getAttribute('step')).toBe('2')
    })

    test('setTabActive is accessible as public method', async () => {
        const screen = render(html`<extension-cropping></extension-cropping>`)
        const el = screen.container.querySelector('extension-cropping')! as Cropping
        await elementUpdated(el)

        expect(typeof el.setTabActive).toBe('function')
    })
})
