import { render } from 'vitest-browser-lit'
import { html, nothing } from 'lit'
import { describe, test, expect, vi } from 'vitest'
import { elementUpdated } from './test-helpers'
import { safeHTML, SafeHTMLDirective } from '../../src/element/safe_html'

const tplPreserve = (content: string) => html`<div id="preserve-test">${safeHTML(content)}</div>`
const tplUpdate = (content: string) => html`<div id="update-test">${safeHTML(content)}</div>`

describe('safeHTML directive', () => {
    test('renders valid HTML elements into container', async () => {
        const screen = render(html`<div id="container">${safeHTML('<h1>Hello</h1><p>World</p>')}</div>`)
        const container = screen.container.querySelector('#container')!
        await elementUpdated(container as any)

        const h1 = container.querySelector('h1')
        expect(h1).not.toBeNull()
        expect(h1?.textContent).toBe('Hello')

        const p = container.querySelector('p')
        expect(p).not.toBeNull()
        expect(p?.textContent).toBe('World')
    })

    test('renders nothing when value is null, undefined, or nothing', async () => {
        const screenNull = render(html`<div id="null-container">${safeHTML(null as any)}</div>`)
        const containerNull = screenNull.container.querySelector('#null-container')!
        await elementUpdated(containerNull as any)
        expect(containerNull.children.length).toBe(0)

        const screenUndefined = render(html`<div id="undef-container">${safeHTML(undefined as any)}</div>`)
        const containerUndef = screenUndefined.container.querySelector('#undef-container')!
        await elementUpdated(containerUndef as any)
        expect(containerUndef.children.length).toBe(0)

        const screenNothing = render(html`<div id="nothing-container">${safeHTML(nothing)}</div>`)
        const containerNothing = screenNothing.container.querySelector('#nothing-container')!
        await elementUpdated(containerNothing as any)
        expect(containerNothing.children.length).toBe(0)
    })

    test('throws error when called with non-string value', () => {
        const directive = new SafeHTMLDirective({ type: 2 } as any) // PartType.CHILD = 2
        expect(() => directive.render(123 as any)).toThrow('safeHTML() called with a non-string value')
        expect(() => directive.render({} as any)).toThrow('safeHTML() called with a non-string value')
    })

    test('throws error when used in non-child binding', () => {
        expect(() => new SafeHTMLDirective({ type: 1 } as any)).toThrow('safeHTML() can only be used in child bindings')
    })

    test('preserves DOM nodes when value does not change', async () => {
        const text = '<span>Initial</span>'
        const screen = render(tplPreserve(text))

        const span1 = screen.container.querySelector('#preserve-test span')!
        expect(span1).not.toBeNull()
        expect(span1.textContent).toBe('Initial')

        // Re-render with same value
        screen.rerender(tplPreserve(text))

        const span2 = screen.container.querySelector('#preserve-test span')!
        expect(span2).toBe(span1) // Exact same DOM node instance
    })

    test('updates DOM when value changes', async () => {
        const screen = render(tplUpdate('<span>First</span>'))
        expect(screen.container.querySelector('#update-test span')?.textContent).toBe('First')

        screen.rerender(tplUpdate('<span>Second</span>'))
        expect(screen.container.querySelector('#update-test span')?.textContent).toBe('Second')
    })

    test('uses setHTML when documentElement.setHTML is available', () => {
        const originalSetHTML = (document.documentElement as any).setHTML
        const originalTemplateSetHTML = (HTMLTemplateElement.prototype as any).setHTML
        const setHTMLMock = vi.fn(function (this: HTMLTemplateElement, str: string) {
            this.innerHTML = str
        })

        try {
            ;(document.documentElement as any).setHTML = setHTMLMock
            ;(HTMLTemplateElement.prototype as any).setHTML = setHTMLMock

            const directive = new SafeHTMLDirective({ type: 2 } as any)
            directive.render('<b>Sanitized text</b>')

            expect(setHTMLMock).toHaveBeenCalledWith('<b>Sanitized text</b>')
        } finally {
            if (originalSetHTML !== undefined) {
                ;(document.documentElement as any).setHTML = originalSetHTML
            } else {
                delete (document.documentElement as any).setHTML
            }
            if (originalTemplateSetHTML !== undefined) {
                ;(HTMLTemplateElement.prototype as any).setHTML = originalTemplateSetHTML
            } else {
                delete (HTMLTemplateElement.prototype as any).setHTML
            }
        }
    })

    test('falls back to innerHTML when setHTML is not supported', () => {
        const originalSetHTML = (document.documentElement as any).setHTML
        const originalTemplateSetHTML = (HTMLTemplateElement.prototype as any).setHTML

        try {
            delete (document.documentElement as any).setHTML
            delete (HTMLTemplateElement.prototype as any).setHTML

            const directive = new SafeHTMLDirective({ type: 2 } as any)
            const result = directive.render('<i>Fallback text</i>') as DocumentFragment

            expect(result).toBeInstanceOf(DocumentFragment)
            expect(result.querySelector('i')?.textContent).toBe('Fallback text')
        } finally {
            if (originalSetHTML !== undefined) {
                ;(document.documentElement as any).setHTML = originalSetHTML
            }
            if (originalTemplateSetHTML !== undefined) {
                ;(HTMLTemplateElement.prototype as any).setHTML = originalTemplateSetHTML
            }
        }
    })
})
