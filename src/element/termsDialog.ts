import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import '@material/web/dialog/dialog'
import '@material/web/button/filled-tonal-button'
import '@material/web/icon/icon'
import type { MdDialog } from '@material/web/dialog/dialog'
import { Settings } from './settings'
import { Configuration } from '../configuration'
import type { FetchConfigMessage } from '../message'
import { t } from '../i18n'
import { sendEvent } from '../sentry'

@customElement('extension-terms-dialog')
export class TermsDialog extends LitElement {
    static override readonly styles = css`
        md-dialog {
            width: 600px;
            --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high));
        }
        a {
            color: var(--theme-link, #1a73e8);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    `

    private confirmed = false

    private configListener: ((e: Event) => void) | null = null

    override connectedCallback() {
        super.connectedCallback()
        this.configListener = (e: Event) => {
            if (!(e instanceof CustomEvent)) return
            const config = e.detail as Configuration
            if (config.hasAgreedTerms) {
                this.confirmed = true
                this.getDialog()?.close('ok')
            }
        }
        window.addEventListener(Settings.CONFIG_CHANGED_EVENT, this.configListener)
    }

    override disconnectedCallback() {
        super.disconnectedCallback()
        if (this.configListener) {
            window.removeEventListener(Settings.CONFIG_CHANGED_EVENT, this.configListener)
            this.configListener = null
        }
    }

    protected override firstUpdated() {
        this.checkAgreement().catch(e => console.error('checkAgreement failed:', e))
    }

    public getDialog(): MdDialog | null {
        return this.shadowRoot?.querySelector('md-dialog') ?? null
    }

    public async checkAgreement() {
        const config = Settings.getConfiguration()
        if (config.hasAgreedTerms) {
            return
        }

        // Try checking remote configuration in case it was synced from another device
        try {
            const msg: FetchConfigMessage = { type: 'fetch-config' }
            const remoteConfig = await chrome.runtime.sendMessage<FetchConfigMessage, Configuration | undefined>(msg)
            if (remoteConfig?.hasAgreedTerms) {
                Settings.mergeRemoteConfiguration(remoteConfig)
                return
            }
        } catch (e) {
            console.debug('Failed to fetch remote config:', e)
        }

        this.showDialog()
    }

    public showDialog(): boolean {
        const dialog = this.getDialog()
        if (!dialog) return false
        this.confirmed = false
        dialog.show()
        return true
    }

    private handleCancel(e: Event) {
        // Prevent dialog from canceling (via backdrop click or Escape key)
        e.preventDefault()
    }

    private handleClose(e: Event) {
        // Prevent dialog from closing unless confirmed via OK button
        if (!this.confirmed) {
            e.preventDefault()
        }
    }

    private handleKeydown(e: KeyboardEvent) {
        // Explicitly prevent Escape key from closing the dialog
        if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
        }
    }

    private async handleOk(e: Event) {
        e.preventDefault()
        this.confirmed = true
        const config = Settings.getConfiguration()
        config.hasAgreedTerms = true
        Settings.setConfiguration(config)
        await Settings.syncConfiguration(config)
        sendEvent({ type: 'agree_terms' })

        const dialog = this.getDialog()
        dialog?.close('ok')
    }

    public override render() {
        const termsUrl = t('termsUrl')
        const placeholder = '__LINK__'
        const fullText = t('termsDescription', [placeholder])
        const [before, after] = fullText.includes(placeholder) ? fullText.split(placeholder) : [fullText, '']

        return html`
            <md-dialog @cancel=${this.handleCancel} @close=${this.handleClose} @keydown=${this.handleKeydown}>
                <div slot="headline">${t('termsHeadline')}</div>
                <md-icon slot="icon">description</md-icon>
                <form id="form" slot="content" method="dialog">
                    <p>${before}<a href=${termsUrl} target="_blank" rel="noopener">${t('termsLinkText')}</a>${after}</p>
                </form>
                <div slot="actions">
                    <md-filled-tonal-button form="form" value="ok" autofocus @click=${this.handleOk}
                        >${t('termsOkButton')}</md-filled-tonal-button
                    >
                </div>
            </md-dialog>
        `
    }
}

export default TermsDialog

declare global {
    interface HTMLElementTagNameMap {
        'extension-terms-dialog': TermsDialog
    }
}
