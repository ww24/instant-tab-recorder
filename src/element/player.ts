import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/iconbutton/icon-button'
import '@material/web/button/filled-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/button/text-button'
import '@material/web/progress/circular-progress'
import '@material/web/dialog/dialog'
import '@material/web/menu/menu'
import '@material/web/menu/menu-item'
import { Settings } from './settings'
import type { TranscriptionSegment } from '../transcription/types'
import { formatSeconds } from '../transcription/utils'
import type { Message } from '../message'
import { t } from '../i18n'
import { applyTheme } from '../theme'
import { recordingApi } from '../api_client'
import { OPFSModelCache } from '../transcription/opfs_model_cache'

@customElement('extension-player')
export class Player extends LitElement {
    static override readonly styles = css`
        :host {
            display: block;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background-color: #000;
            color: #fff;
            font-family:
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                'Segoe UI',
                Roboto,
                sans-serif;
        }

        .layout-simple {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .layout-simple video {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        .layout-with-panel {
            display: flex;
            width: 100%;
            height: 100%;
        }

        .video-container {
            flex: 1;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #000;
            overflow: hidden;
            position: relative;
        }

        .video-container video {
            max-width: 100%;
            max-height: 100%;
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        /* Subtitle / Closed Caption style with high contrast */
        video::cue {
            background-color: rgba(0, 0, 0, 0.8) !important;
            color: #ffffff !important;
            font-size: 1.1rem !important;
            line-height: 1.4 !important;
            padding: 4px 8px !important;
            border-radius: 4px !important;
        }

        .transcription-panel {
            width: 380px;
            height: 100%;
            background-color: #1a1a1a;
            border-left: 1px solid #333;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
        }

        .panel-header {
            padding: 16px;
            border-bottom: 1px solid #333;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .panel-header h3 {
            margin: 0;
            font-size: 1.125rem;
            font-weight: 600;
        }

        .panel-actions {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .menu-anchor-wrapper {
            position: relative;
            display: inline-block;
        }

        .panel-content {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }

        .status-center {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 32px 16px;
            text-align: center;
            gap: 16px;
        }

        .status-center p {
            margin: 0;
            color: #aaa;
            font-size: 0.9375rem;
        }

        .progress-sub {
            color: #888;
            font-size: 0.8125rem;
        }

        .segment-list {
            padding: 8px 0;
        }

        .segment-item {
            padding: 10px 16px;
            cursor: pointer;
            transition: background-color 0.15s;
            border-bottom: 1px solid #282828;
            border-left: 3px solid transparent;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .segment-item:hover {
            background-color: #2a2a2a;
        }

        .segment-item.active {
            background-color: rgba(77, 163, 255, 0.15);
            border-left-color: #4da3ff;
        }

        .segment-item .timestamp {
            font-size: 0.75rem;
            color: #4da3ff;
            font-weight: 500;
        }

        .segment-item .text {
            font-size: 0.875rem;
            line-height: 1.4;
            color: #e0e0e0;
        }

        .error-banner {
            padding: 12px 16px;
            background-color: rgba(244, 67, 54, 0.15);
            border-bottom: 1px solid rgba(244, 67, 54, 0.3);
            color: #ff8a80;
            font-size: 0.875rem;
        }

        .error-banner p {
            margin: 0;
        }

        .error-banner .open-settings-button {
            margin-top: 8px;
        }

        md-dialog {
            width: 480px;
            --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high, #1e1e2a));
            --md-dialog-headline-color: var(--theme-text, #e8e8f0);
            --md-dialog-supporting-text-color: var(--theme-text-secondary, #a0a0b8);
            --md-text-button-label-text-color: var(--theme-error, #f44336);
            --md-text-button-focus-label-text-color: var(--theme-error, #f44336);
            --md-text-button-hover-label-text-color: var(--theme-error, #f44336);
            --md-text-button-pressed-label-text-color: var(--theme-error, #f44336);
        }

        .dialog-content {
            display: flex;
            flex-direction: column;
            gap: 12px;
            color: var(--theme-text-secondary, #a0a0b8);
            font-size: 0.9375rem;
            line-height: 1.5;
        }

        md-menu {
            --md-menu-container-color: var(--theme-dialog-bg, #1e1e2a);
            --md-menu-container-shape: 8px;
        }

        md-menu-item {
            --md-menu-item-label-text-color: var(--theme-text, #e8e8f0);
            --md-menu-item-icon-color: var(--theme-text-secondary, #a0a0b8);
        }
    `

    @property({ type: String }) path = ''
    @state() private transcriptionEnabled = false
    @state() private transcriptionFetched = false
    @state() private hasTranscription = false
    @state() private transcriptionSegments: TranscriptionSegment[] | null = null
    @state() private currentTime = 0
    @state() private isTranscribing = false
    @state() private transcribeProgress: { loaded: number; total: number; stage?: string } | null = null
    @state() private transcribeError: string | null = null
    @state() private needsModelRedownload = false
    @state() private showDownloadMenu = false
    @state() private showDeleteDialog = false
    @state() private trackVersion = 0
    @state() private isControlled = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null

    private readonly modelCache = new OPFSModelCache()
    private messageListener?: (message: Message) => void

    constructor() {
        super()
        try {
            const config = Settings.getConfiguration()
            applyTheme(config.uiTheme)
        } catch (e) {
            console.warn('Failed to apply theme in player:', e)
        }
    }

    override connectedCallback() {
        super.connectedCallback()

        if (!this.path) {
            const params = new URLSearchParams(window.location.search)
            this.path = params.get('path') || ''
        }

        this.messageListener = (message: Message) => {
            if (!this.path) return

            switch (message.type) {
                case 'transcription-progress':
                    if (message.path === this.path) {
                        this.isTranscribing = true
                        this.transcribeProgress = {
                            loaded: message.loaded,
                            total: message.total,
                            stage: message.stage,
                        }
                    }
                    break

                case 'transcription-complete':
                    if (message.path === this.path) {
                        this.isTranscribing = false
                        this.transcribeProgress = null
                        this.transcribeError = null
                        this.trackVersion++
                        this.fetchTranscription()
                    }
                    break

                case 'transcription-error':
                    if (message.path === this.path) {
                        this.isTranscribing = false
                        this.transcribeProgress = null
                        this.transcribeError = message.error
                    }
                    break

                case 'transcription-status-response':
                    if (message.path === this.path) {
                        this.isTranscribing = message.isTranscribing
                    }
                    break
            }
        }

        chrome.runtime.onMessage.addListener(this.messageListener)
    }

    override updated(changedProperties: PropertyValues) {
        super.updated(changedProperties)
        if (changedProperties.has('path')) {
            this.initialize()
        }
        if (changedProperties.has('isControlled') && this.isControlled) {
            const video = this.renderRoot.querySelector('video')
            if (video && video.src) {
                video.play().catch(e => {
                    console.warn('Autoplay prevented:', e)
                })
            }
        }
    }

    override disconnectedCallback() {
        super.disconnectedCallback()
        if (this.messageListener) {
            chrome.runtime.onMessage.removeListener(this.messageListener)
        }
    }

    protected override firstUpdated() {
        const video = this.renderRoot.querySelector('video')
        if (video) {
            video.play().catch(e => {
                console.warn('Autoplay prevented:', e)
            })
        }
    }

    private async initialize() {
        const config = Settings.getConfiguration()
        this.transcriptionEnabled = config.transcription?.enabled ?? false

        if (this.path) {
            try {
                await recordingApi.ensureControlled()
                this.isControlled = true
            } catch (e) {
                console.warn('Failed to ensure service worker control:', e)
            }
            await this.fetchTranscription()
            // Query if transcription is in progress in background
            try {
                await chrome.runtime.sendMessage({
                    type: 'query-transcription-status',
                    path: this.path,
                })
            } catch (e) {
                console.warn('Failed to query transcription status:', e)
            }
        }
    }

    private async fetchTranscription() {
        if (!this.path) return
        try {
            const data = await recordingApi.getTranscription(this.path)
            this.transcriptionFetched = true
            if (data) {
                this.hasTranscription = true
                this.transcriptionSegments = data.segments
            } else {
                this.hasTranscription = false
                this.transcriptionSegments = []
            }
        } catch (e) {
            console.error('Failed to fetch transcription:', e)
            this.transcriptionFetched = true
            this.hasTranscription = false
            this.transcriptionSegments = []
        }
    }

    private async startTranscription() {
        if (!this.path) return
        this.isTranscribing = true
        this.transcribeError = null
        this.transcribeProgress = null
        this.needsModelRedownload = false

        try {
            const hasCache = await this.modelCache.hasCache()
            if (!hasCache) {
                this.isTranscribing = false
                this.needsModelRedownload = true
                this.transcribeError = t('playerModelRedownloadRequired')
                return
            }
        } catch (e) {
            console.error('Failed to check model cache:', e)
            this.isTranscribing = false
            this.needsModelRedownload = true
            this.transcribeError = t('playerModelRedownloadRequired')
            return
        }

        chrome.runtime
            .sendMessage({
                type: 'start-transcription',
                path: this.path,
            })
            .catch(e => {
                console.error('Failed to start transcription:', e)
                this.isTranscribing = false
                this.transcribeError = e instanceof Error ? e.message : String(e)
            })
    }

    private openSettingsForTranscription() {
        const url = chrome.runtime.getURL('option.html?tab=settings#transcription')
        window.open(url, '_blank')
    }

    private handleTimeUpdate(e: Event) {
        const video = e.target as HTMLVideoElement
        if (video) {
            this.currentTime = video.currentTime
        }
    }

    private seekTo(seconds: number) {
        const video = this.renderRoot.querySelector('video')
        if (video) {
            video.currentTime = seconds
            video.play().catch(() => {})
        }
    }

    private openDeleteDialog() {
        this.showDeleteDialog = true
    }

    private closeDeleteDialog() {
        this.showDeleteDialog = false
    }

    private async confirmDelete() {
        this.closeDeleteDialog()
        if (!this.path) return

        try {
            await recordingApi.deleteTranscription(this.path)
            this.hasTranscription = false
            this.transcriptionSegments = []
            this.trackVersion++
            await chrome.runtime.sendMessage({
                type: 'transcription-deleted',
                path: this.path,
            })
        } catch (e) {
            console.error('Error deleting transcription:', e)
            this.transcribeError = e instanceof Error ? e.message : String(e)
        }
    }

    private getProgressStageText(): string {
        const stage = this.transcribeProgress?.stage
        switch (stage) {
            case 'model_load':
                return t('playerTranscriptionLoadingModel')
            case 'loudness':
            case 'vad':
                return t('playerTranscriptionPreprocessing')
            case 'inference':
                return t('playerTranscriptionInProgress')
            default:
                return ''
        }
    }

    override render() {
        const encodedPath = encodeURIComponent(this.path)
        const videoSrc = this.isControlled && this.path ? `/api/recordings/${encodedPath}` : ''
        const trackSrc = `/api/recordings/${encodedPath}/transcription.vtt?v=${this.trackVersion}`
        const vttDownloadUrl = `/api/recordings/${encodedPath}/transcription.vtt?download=true`
        const srtDownloadUrl = `/api/recordings/${encodedPath}/transcription.srt?download=true`

        const percent =
            this.transcribeProgress && this.transcribeProgress.total > 0
                ? Math.round((this.transcribeProgress.loaded / this.transcribeProgress.total) * 100)
                : null

        return html`
            <div class=${this.transcriptionEnabled || this.hasTranscription ? 'layout-with-panel' : 'layout-simple'}>
                <!-- Left: Video Player -->
                <div class="video-container">
                    <video controls autoplay src=${videoSrc || nothing} @timeupdate=${this.handleTimeUpdate}>
                        ${
                            this.isControlled && this.hasTranscription && this.transcriptionSegments?.length
                                ? html`<track kind="captions" src=${trackSrc} default label="Captions" />`
                                : ''
                        }
                    </video>
                </div>

                <!-- Right: Transcription Panel (when enabled or already available) -->
                ${
                    this.transcriptionEnabled || this.hasTranscription
                        ? html`
                              <aside class="transcription-panel">
                                  <div class="panel-header">
                                      <h3>${t('settingsTranscription')}</h3>
                                      ${
                                          this.hasTranscription
                                              ? html`
                                                    <div class="panel-actions">
                                                        <span class="menu-anchor-wrapper">
                                                            <md-icon-button
                                                                id="download-menu-anchor"
                                                                title=${t('playerDownloadTranscription')}
                                                                @click=${() =>
                                                                    (this.showDownloadMenu = !this.showDownloadMenu)}>
                                                                <md-icon>download</md-icon>
                                                            </md-icon-button>
                                                            <md-menu
                                                                anchor="download-menu-anchor"
                                                                .open=${this.showDownloadMenu}
                                                                @closed=${() => (this.showDownloadMenu = false)}>
                                                                <md-menu-item
                                                                    href=${vttDownloadUrl}
                                                                    @click=${() => (this.showDownloadMenu = false)}>
                                                                    <div slot="headline">WebVTT&nbsp;(.vtt)</div>
                                                                </md-menu-item>
                                                                <md-menu-item
                                                                    href=${srtDownloadUrl}
                                                                    @click=${() => (this.showDownloadMenu = false)}>
                                                                    <div slot="headline">SubRip&nbsp;(.srt)</div>
                                                                </md-menu-item>
                                                            </md-menu>
                                                        </span>
                                                        <md-icon-button
                                                            @click=${this.openDeleteDialog}
                                                            title=${t('playerDeleteTranscription')}>
                                                            <md-icon>delete</md-icon>
                                                        </md-icon-button>
                                                    </div>
                                                `
                                              : ''
                                      }
                                  </div>

                                  <div class="panel-content">
                                      ${
                                          this.transcribeError
                                              ? html`
                                                    <div class="error-banner">
                                                        <p>${this.transcribeError}</p>
                                                        ${
                                                            this.needsModelRedownload
                                                                ? html`
                                                                      <md-filled-tonal-button
                                                                          class="open-settings-button"
                                                                          @click=${this.openSettingsForTranscription}>
                                                                          <md-icon slot="icon">settings</md-icon>
                                                                          ${t('playerOpenSettings')}
                                                                      </md-filled-tonal-button>
                                                                  `
                                                                : ''
                                                        }
                                                    </div>
                                                `
                                              : ''
                                      }
                                      ${
                                          this.isTranscribing
                                              ? html`
                                                    <div class="status-center">
                                                        <md-circular-progress indeterminate></md-circular-progress>
                                                        <p>${this.getProgressStageText()}</p>
                                                        <p class="progress-sub">
                                                            ${
                                                                percent !== null &&
                                                                (this.transcribeProgress?.stage === 'model_load' ||
                                                                    this.transcribeProgress?.stage === 'inference')
                                                                    ? `${percent}%`
                                                                    : html`&nbsp;`
                                                            }
                                                        </p>
                                                    </div>
                                                `
                                              : !this.transcriptionFetched
                                                ? html`
                                                      <div class="status-center">
                                                          <md-circular-progress indeterminate></md-circular-progress>
                                                      </div>
                                                  `
                                                : !this.hasTranscription
                                                  ? html`
                                                        <div class="status-center">
                                                            <md-filled-button @click=${this.startTranscription}>
                                                                <md-icon slot="icon">subtitles</md-icon>
                                                                ${t('playerStartTranscription')}
                                                            </md-filled-button>
                                                        </div>
                                                    `
                                                  : this.transcriptionSegments?.length === 0
                                                    ? html`
                                                          <div class="status-center">
                                                              <p>${t('playerNoSpeechDetected')}</p>
                                                          </div>
                                                      `
                                                    : html`
                                                          <div class="segment-list">
                                                              ${this.transcriptionSegments!.map(seg => {
                                                                  const isActive =
                                                                      seg.startSec <= this.currentTime &&
                                                                      this.currentTime <= seg.endSec
                                                                  return html`
                                                                      <div
                                                                          class="segment-item ${
                                                                              isActive ? 'active' : ''
                                                                          }"
                                                                          role="button"
                                                                          tabindex="0"
                                                                          @click=${() => this.seekTo(seg.startSec)}
                                                                          @keydown=${(e: KeyboardEvent) => {
                                                                              if (e.key === 'Enter' || e.key === ' ') {
                                                                                  e.preventDefault()
                                                                                  this.seekTo(seg.startSec)
                                                                              }
                                                                          }}>
                                                                          <span class="timestamp"
                                                                              >${formatSeconds(seg.startSec)}</span
                                                                          >
                                                                          <span class="text">${seg.text}</span>
                                                                      </div>
                                                                  `
                                                              })}
                                                          </div>
                                                      `
                                      }
                                  </div>
                              </aside>
                          `
                        : ''
                }
            </div>

            <!-- Delete Confirmation Dialog -->
            ${
                this.showDeleteDialog
                    ? html`
                          <md-dialog open @closed=${this.closeDeleteDialog}>
                              <div slot="headline">${t('playerDeleteTranscriptionHeadline')}</div>
                              <md-icon slot="icon">delete_outline</md-icon>
                              <div slot="content" class="dialog-content">
                                  ${t('playerDeleteTranscriptionDescription')}
                              </div>
                              <div slot="actions">
                                  <md-text-button @click=${this.confirmDelete}>
                                      ${t('confirmDeleteButton')}
                                  </md-text-button>
                                  <md-filled-tonal-button @click=${this.closeDeleteDialog} autofocus>
                                      ${t('confirmCancelButton')}
                                  </md-filled-tonal-button>
                              </div>
                          </md-dialog>
                      `
                    : ''
            }
        `
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-player': Player
    }
}
