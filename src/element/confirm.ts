import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/list/list'
import '@material/web/list/list-item'
import '@material/web/divider/divider'
import { formatFileSize } from './util'
import { RecordEntry } from './recordList'
import { t } from '../i18n'

@customElement('extension-confirm')
export default class Confirm extends LitElement {
    static override readonly styles = css`
        md-dialog {
            width: 600px;
            --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high));
            --md-text-button-label-text-color: var(--theme-error, #f44336);
            --md-text-button-focus-label-text-color: var(--theme-error, #f44336);
            --md-text-button-hover-label-text-color: var(--theme-error, #f44336);
            --md-text-button-pressed-label-text-color: var(--theme-error, #f44336);
        }
    `

    @property({ noAccessor: true })
    private records: Array<RecordEntry>

    public constructor() {
        super()
        this.records = []
    }

    public override render() {
        return html`
            <md-dialog>
                <div slot="headline">${t('confirmDeleteHeadline')}</div>
                <md-icon slot="icon">delete_outline</md-icon>
                <form id="form" slot="content" method="dialog">
                    ${t('confirmDeleteDescription')}<br />
                    ${t('confirmDeleteRecords')}
                    <md-list>
                        ${this.records.map(
                            (record, i) => html`
                                ${i > 0 ? html`<md-divider></md-divider>` : html``}
                                <md-list-item
                                    >${record.title}
                                    <div slot="end">
                                        (${t('confirmSizeLabel', formatFileSize(record.size + record.subFilesSize))})
                                    </div></md-list-item
                                >
                            `,
                        )}
                    </md-list>
                </form>
                <div slot="actions">
                    <md-text-button form="form" value="delete">${t('confirmDeleteButton')}</md-text-button>
                    <md-filled-tonal-button form="form" value="cancel" autofocus
                        >${t('confirmCancelButton')}</md-filled-tonal-button
                    >
                </div>
            </md-dialog>
        `
    }

    public setRecords(records: Array<RecordEntry>) {
        const oldVal = [...this.records]
        this.records = records
        this.requestUpdate('records', oldVal)
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-confirm': Confirm
    }
}
