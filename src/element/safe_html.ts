import { Directive, directive, PartType } from 'lit/directive.js'
import type { PartInfo } from 'lit/directive.js'
import { noChange, nothing } from 'lit'

/**
 * HTML 文字列を安全に DOM に挿入するための Lit Directive。
 *
 * documentElement.setHTML が利用できる場合は利用し、利用できない場合は innerHTML に fallback します。
 * 古いブラウザでは setHTML に未対応のため Sanitize されませんが許容します。
 */
export class SafeHTMLDirective extends Directive {
    private value?: string

    constructor(partInfo: PartInfo) {
        super(partInfo)
        if (partInfo.type !== PartType.CHILD) {
            throw new Error('safeHTML() can only be used in child bindings')
        }
    }

    render(value: unknown) {
        if (value === nothing || value === null || value === undefined) {
            this.value = undefined
            return nothing
        }
        if (value === noChange) {
            return noChange
        }
        if (typeof value !== 'string') {
            throw new Error('safeHTML() called with a non-string value')
        }
        if (value === this.value) {
            return noChange
        }
        this.value = value

        const template = document.createElement('template')
        // documentElement.setHTML が利用できる場合は利用し、利用できない場合は innerHTML に fallback します。
        // 古いブラウザでは setHTML に未対応のため Sanitize されませんが許容します。
        if (
            'setHTML' in document.documentElement &&
            typeof (template as unknown as { setHTML?: (html: string) => void }).setHTML === 'function'
        ) {
            ;(template as unknown as { setHTML: (html: string) => void }).setHTML(value)
        } else {
            template.innerHTML = value
        }

        const content = template.content
        if (content && content.childNodes.length > 0) {
            return content.cloneNode(true)
        }
        const fragment = document.createDocumentFragment()
        while (template.firstChild) {
            fragment.appendChild(template.firstChild)
        }
        return fragment
    }
}

export const safeHTML = directive(SafeHTMLDirective)
