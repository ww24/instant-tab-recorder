import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/checkbox/checkbox'
import '@material/web/icon/icon'
import { MdDialog } from '@material/web/dialog/dialog'
import { MdCheckbox } from '@material/web/checkbox/checkbox'
import { TIMER_STOP_CONFIRM_PENDING_KEY as PENDING_KEY, TIMER_STOP_TRIGGER_KEY as TRIGGER_KEY } from '../message'
import type { ConfirmTimerStopMessage, SaveConfigSyncMessage, Trigger } from '../message'
import { Settings } from './settings'
import { Configuration } from '../configuration'
import { t } from '../i18n'

@customElement('extension-timer-stop-confirm')
export default class TimerStopConfirm extends LitElement {
    static override readonly styles = css`
        md-dialog {
            width: 600px;
            --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high));
        }
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 12px;
        }
    `

    @property({ noAccessor: true })
    private dontShowAgain: boolean = false

    private trigger: Trigger = 'action-icon'

    private storageListener:
        | ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => Promise<void>)
        | null = null

    override connectedCallback() {
        super.connectedCallback()
        // Listen for flag changes
        this.storageListener = async (changes, areaName) => {
            if (areaName !== 'local' || !(PENDING_KEY in changes)) return
            if (!changes[PENDING_KEY].newValue) return

            const result = await chrome.storage.local.get(TRIGGER_KEY)
            this.trigger = (result[TRIGGER_KEY] ?? 'action-icon') as Trigger
            await this.updateComplete
            if (this.showDialog()) {
                await chrome.storage.local.remove([PENDING_KEY, TRIGGER_KEY])
            }
        }
        chrome.storage.onChanged.addListener(this.storageListener)
    }

    override disconnectedCallback() {
        super.disconnectedCallback()
        if (this.storageListener) {
            chrome.storage.onChanged.removeListener(this.storageListener)
            this.storageListener = null
        }
    }

    protected override firstUpdated() {
        // Check on initial load after first render ensures <md-dialog> is available
        this.checkPending().catch(e => console.error('checkPending failed:', e))
    }

    public override render() {
        return html`
            <md-dialog>
                <div slot="headline">${t('timerStopHeadline')}</div>
                <md-icon slot="icon">timer</md-icon>
                <form id="form" slot="content" method="dialog">
                    <p>${t('timerStopDescription')}</p>
                    <div class="checkbox-row">
                        <md-checkbox id="dont-show" @change=${this.onCheckboxChange}></md-checkbox>
                        <label for="dont-show">${t('timerStopDontShowAgain')}</label>
                    </div>
                </form>
                <div slot="actions">
                    <md-text-button form="form" value="stop" @click=${this.onStop}
                        >${t('timerStopStopButton')}</md-text-button
                    >
                    <md-filled-tonal-button form="form" value="continue" autofocus @click=${this.onContinue}
                        >${t('timerStopContinueButton')}</md-filled-tonal-button
                    >
                </div>
            </md-dialog>
        `
    }

    private async checkPending() {
        const result = await chrome.storage.local.get([PENDING_KEY, TRIGGER_KEY])
        if (result[PENDING_KEY] === true) {
            this.trigger = (result[TRIGGER_KEY] ?? 'action-icon') as Trigger
            if (this.showDialog()) {
                await chrome.storage.local.remove([PENDING_KEY, TRIGGER_KEY])
            }
        }
    }

    private showDialog(): boolean {
        if (this.shadowRoot == null) return false
        const dialog = this.shadowRoot.querySelector('md-dialog') as MdDialog | null
        if (dialog == null) return false
        this.dontShowAgain = false
        // Reset checkbox
        const checkbox = this.shadowRoot.querySelector('#dont-show') as MdCheckbox | null
        if (checkbox) checkbox.checked = false
        dialog.show()
        return true
    }

    private onCheckboxChange(e: Event) {
        if (e.target instanceof MdCheckbox) {
            this.dontShowAgain = e.target.checked
        }
    }

    private async onStop() {
        if (this.dontShowAgain) {
            const config = Settings.getConfiguration()
            config.recordingTimer.skipStopConfirmation = true
            Settings.setConfiguration(config)
            const syncMsg: SaveConfigSyncMessage = {
                type: 'save-config-sync',
                data: Configuration.filterForSync(config),
            }
            await chrome.runtime.sendMessage(syncMsg)
        }

        const msg: ConfirmTimerStopMessage = { type: 'confirm-timer-stop', trigger: this.trigger }
        await chrome.runtime.sendMessage(msg)
    }

    private async onContinue() {
        // Dialog dismissed, no action needed
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-timer-stop-confirm': TimerStopConfirm
    }
}
