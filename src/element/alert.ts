import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'
import { t } from '../i18n'

@customElement('extension-alert')
export default class Alert extends LitElement {
    static override readonly styles = css`
        md-dialog {
            width: 600px;
            --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high));
        }
        pre {
            overflow-x: scroll;
            margin: 0;
            font-size: 0.8rem;
        }
    `

    @property({ noAccessor: true })
    private headline: string = t('alertDefaultHeadline')

    @property({ noAccessor: true })
    private content: string = ''

    @property({ noAccessor: true })
    private preformatted: boolean = false

    public constructor() {
        super()
    }

    public override render() {
        return html`
            <md-dialog>
                <div slot="headline">${this.headline}</div>
                <form id="form" slot="content" method="dialog">
                    ${this.preformatted
                        ? html`<pre>${this.content}</pre>`
                        : this.content.split('\n').map(p => html`<p>${p}</p>`)}
                </form>
                <div slot="actions">
                    <md-text-button form="form" value="ok" autofocus>${t('alertOk')}</md-text-button>
                </div>
            </md-dialog>
        `
    }

    public setContent(headline: string, content: string, options?: { preformatted?: boolean }) {
        const oldHeadline = this.headline
        this.headline = headline
        this.requestUpdate('headline', oldHeadline)
        const oldContent = this.content
        this.content = content
        this.requestUpdate('content', oldContent)
        const oldPreformatted = this.preformatted
        this.preformatted = options?.preformatted ?? false
        this.requestUpdate('preformatted', oldPreformatted)
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-alert': Alert
    }
}
