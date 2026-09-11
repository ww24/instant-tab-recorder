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
import { marked } from 'marked'
import { safeHTML } from './safe_html'
import { Settings } from './settings'
import type { TranscriptionSegment } from '../transcription/types'
import { formatSeconds } from '../transcription/utils'
import type { Message } from '../message'
import { t } from '../i18n'
import { applyTheme } from '../theme'
import { recordingApi } from '../api_client'
import { OPFSModelCache } from '../ml/opfs_model_cache'
import { REQUIRED_TRANSCRIPTION_MODEL_FILES } from '../transcription/model_files'
import { TRANSCRIPTION_MODEL_CACHE_DIR } from '../transcription/model_downloader'
import { REQUIRED_SUMMARY_MODEL_FILES } from '../summary/model_files'
import { SUMMARY_MODEL_CACHE_DIR } from '../summary/model_downloader'

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
        }

        md-dialog.delete-dialog {
            --md-text-button-label-text-color: var(--theme-error, #f44336);
            --md-text-button-focus-label-text-color: var(--theme-error, #f44336);
            --md-text-button-hover-label-text-color: var(--theme-error, #f44336);
            --md-text-button-pressed-label-text-color: var(--theme-error, #f44336);
        }

        md-dialog.summary-dialog {
            width: 560px;
            max-width: 90vw;
            max-height: 80vh;
        }

        .dialog-content {
            display: flex;
            flex-direction: column;
            gap: 12px;
            color: var(--theme-text-secondary, #a0a0b8);
            font-size: 0.9375rem;
            line-height: 1.5;
        }

        .summary-body {
            word-break: break-word;
            font-size: 0.9375rem;
            line-height: 1.6;
            color: var(--theme-text, #e8e8f0);
            padding: 4px 0;
        }

        .summary-body h1,
        .summary-body h2,
        .summary-body h3,
        .summary-body h4 {
            color: var(--theme-text, #e8e8f0);
            margin-top: 16px;
            margin-bottom: 8px;
            font-weight: 600;
            line-height: 1.3;
        }

        .summary-body h1:first-child,
        .summary-body h2:first-child,
        .summary-body h3:first-child,
        .summary-body h4:first-child {
            margin-top: 0;
        }

        .summary-body h1 {
            font-size: 1.25rem;
        }

        .summary-body h2 {
            font-size: 1.125rem;
        }

        .summary-body h3 {
            font-size: 1rem;
        }

        .summary-body p {
            margin: 0 0 8px;
        }

        .summary-body p:last-child {
            margin-bottom: 0;
        }

        .summary-body ul,
        .summary-body ol {
            margin: 0 0 8px;
            padding-left: 20px;
        }

        .summary-body li {
            margin-bottom: 4px;
        }

        .summary-body code {
            font-family: monospace;
            background: var(--theme-code-bg, rgba(255, 255, 255, 0.1));
            padding: 2px 4px;
            border-radius: 4px;
            font-size: 0.85em;
        }

        .summary-body pre {
            background: var(--theme-code-bg, rgba(255, 255, 255, 0.1));
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
        }

        .summary-body pre code {
            background: none;
            padding: 0;
        }

        .summary-body blockquote {
            border-left: 3px solid var(--theme-primary, #6750a4);
            margin: 8px 0;
            padding-left: 12px;
            color: var(--theme-text-secondary, #a0a0b8);
        }

        .summary-body a {
            color: var(--theme-link, #8ab4f8);
            text-decoration: underline;
        }

        .summary-notice {
            text-align: center;
            padding: 24px 16px;
            color: var(--theme-text-secondary, #a0a0b8);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
        }

        .summary-notice p {
            margin: 0;
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

    private readonly transcriptionModelCache = new OPFSModelCache(
        TRANSCRIPTION_MODEL_CACHE_DIR,
        REQUIRED_TRANSCRIPTION_MODEL_FILES,
    )

    @state() private showSummaryDialog = false
    @state() private isSummarizing = false
    @state() private summaryProgress: { loaded: number; total: number; stage?: string } | null = null
    @state() private summaryError: string | null = null
    @state() private summaryText: string | null = null
    @state() private summaryCopied = false
    @state() private isSummaryModelReady = false
    @state() private needsSummaryModelRedownload = false

    private readonly summaryModelCache = new OPFSModelCache(SUMMARY_MODEL_CACHE_DIR, REQUIRED_SUMMARY_MODEL_FILES)

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

                case 'summary-progress':
                    if (message.path === this.path) {
                        this.isSummarizing = true
                        this.summaryProgress = {
                            loaded: message.loaded,
                            total: message.total,
                            stage: message.stage,
                        }
                    }
                    break

                case 'summary-complete':
                    if (message.path === this.path) {
                        this.isSummarizing = false
                        this.summaryProgress = null
                        this.summaryError = null
                        this.summaryText = message.summary.text
                    }
                    break

                case 'summary-error':
                    if (message.path === this.path) {
                        this.isSummarizing = false
                        this.summaryProgress = null
                        this.summaryError = message.error
                    }
                    break

                case 'summary-status-response':
                    if (message.path === this.path) {
                        this.isSummarizing = message.isSummarizing
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
            await this.fetchSummary()
            await this.checkSummaryModelReady()
            // Query if transcription or summary is in progress in background
            try {
                await chrome.runtime.sendMessage({
                    type: 'query-transcription-status',
                    path: this.path,
                })
            } catch (e) {
                console.warn('Failed to query transcription status:', e)
            }
            try {
                await chrome.runtime.sendMessage({
                    type: 'query-summary-status',
                    path: this.path,
                })
            } catch (e) {
                console.warn('Failed to query summary status:', e)
            }
        }
    }

    private async checkSummaryModelReady() {
        try {
            this.isSummaryModelReady = await this.summaryModelCache.hasCache(REQUIRED_SUMMARY_MODEL_FILES)
        } catch (e) {
            console.warn('Failed to check summary model cache:', e)
            this.isSummaryModelReady = false
        }
    }

    private async fetchSummary() {
        if (!this.path) return
        try {
            const data = await recordingApi.getSummary(this.path)
            if (data) {
                this.summaryText = data.text
            } else {
                this.summaryText = null
            }
        } catch (e) {
            console.error('Failed to fetch summary:', e)
            this.summaryText = null
        }
    }

    private async openSummaryDialog() {
        this.showSummaryDialog = true
        this.summaryCopied = false
        this.summaryError = null
        this.needsSummaryModelRedownload = false
        await this.checkSummaryModelReady()
        if (!this.summaryText) {
            await this.fetchSummary()
        }
    }

    private closeSummaryDialog() {
        this.showSummaryDialog = false
    }

    private async startSummary() {
        if (!this.path) return
        this.isSummarizing = true
        this.summaryError = null
        this.needsSummaryModelRedownload = false
        this.summaryProgress = null

        try {
            const hasCache = await this.summaryModelCache.hasCache()
            if (!hasCache) {
                this.isSummarizing = false
                this.needsSummaryModelRedownload = true
                this.summaryError = t('playerSummaryModelRedownloadRequired')
                return
            }
        } catch (e) {
            console.error('Failed to check summary model cache:', e)
            this.isSummarizing = false
            this.needsSummaryModelRedownload = true
            this.summaryError = t('playerSummaryModelRedownloadRequired')
            return
        }

        chrome.runtime
            .sendMessage({
                type: 'start-summary',
                path: this.path,
            })
            .catch(e => {
                console.error('Failed to start summary:', e)
                this.isSummarizing = false
                this.summaryError = e instanceof Error ? e.message : String(e)
            })
    }

    private async copySummary() {
        if (!this.summaryText) return
        try {
            await navigator.clipboard.writeText(this.summaryText)
            this.summaryCopied = true
            setTimeout(() => {
                this.summaryCopied = false
            }, 2000)
        } catch (e) {
            console.error('Failed to copy summary:', e)
        }
    }

    private getSummaryProgressText(): string {
        const stage = this.summaryProgress?.stage
        switch (stage) {
            case 'model_load':
                return t('playerSummaryLoadingModel')
            case 'generating':
                return t('playerSummaryGenerating')
            default:
                return t('playerSummaryGenerating')
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
            const hasCache = await this.transcriptionModelCache.hasCache()
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

    private openSettingsForSummary() {
        const url = chrome.runtime.getURL('option.html?tab=settings#summary')
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
            // Cancel any in-flight transcription / summary tasks before deleting
            // data so a finishing worker cannot restore what we are about to remove.
            await chrome.runtime
                .sendMessage({ type: 'cancel-tasks-for-path', path: this.path })
                .catch(e => console.warn('Failed to send cancel-tasks-for-path:', e))

            await recordingApi.deleteTranscription(this.path)
            this.hasTranscription = false
            this.transcriptionSegments = []
            this.trackVersion++
            await chrome.runtime.sendMessage({
                type: 'transcription-deleted',
                path: this.path,
            })
            try {
                await recordingApi.deleteSummary(this.path)
                this.summaryText = null
            } catch (e) {
                console.warn('Failed to delete summary:', e)
            }
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
                                                        ${
                                                            this.transcriptionSegments?.length
                                                                ? html`
                                                                      <md-icon-button
                                                                          id="summary-button"
                                                                          title=${t('playerSummary')}
                                                                          @click=${this.openSummaryDialog}>
                                                                          <md-icon>auto_awesome</md-icon>
                                                                      </md-icon-button>
                                                                      <span class="menu-anchor-wrapper">
                                                                          <md-icon-button
                                                                              id="download-menu-anchor"
                                                                              title=${t('playerDownloadTranscription')}
                                                                              @click=${() =>
                                                                                  (this.showDownloadMenu =
                                                                                      !this.showDownloadMenu)}>
                                                                              <md-icon>download</md-icon>
                                                                          </md-icon-button>
                                                                          <md-menu
                                                                              anchor="download-menu-anchor"
                                                                              .open=${this.showDownloadMenu}
                                                                              @closed=${() => (this.showDownloadMenu = false)}>
                                                                              <md-menu-item
                                                                                  href=${vttDownloadUrl}
                                                                                  @click=${() => (this.showDownloadMenu = false)}>
                                                                                  <div slot="headline">
                                                                                      WebVTT&nbsp;(.vtt)
                                                                                  </div>
                                                                              </md-menu-item>
                                                                              <md-menu-item
                                                                                  href=${srtDownloadUrl}
                                                                                  @click=${() => (this.showDownloadMenu = false)}>
                                                                                  <div slot="headline">
                                                                                      SubRip&nbsp;(.srt)
                                                                                  </div>
                                                                              </md-menu-item>
                                                                          </md-menu>
                                                                      </span>
                                                                  `
                                                                : ''
                                                        }
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
                          <md-dialog class="delete-dialog" open @closed=${this.closeDeleteDialog}>
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

            <!-- Summary Dialog -->
            ${this.renderSummaryDialog()}
        `
    }

    private renderSummaryDialog() {
        if (!this.showSummaryDialog) return ''

        return html`
            <md-dialog class="summary-dialog" open @closed=${this.closeSummaryDialog}>
                <div slot="headline">${t('playerSummaryTitle')}</div>
                <md-icon slot="icon">auto_awesome</md-icon>
                <div slot="content" class="dialog-content">
                    ${
                        this.summaryError
                            ? html`
                                  <div class="error-banner">
                                      <p>${this.summaryError}</p>
                                      ${
                                          this.needsSummaryModelRedownload
                                              ? html`
                                                    <md-filled-tonal-button
                                                        class="open-settings-button"
                                                        @click=${this.openSettingsForSummary}>
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
                        this.isSummarizing
                            ? html`
                                  <div class="status-center">
                                      <md-circular-progress indeterminate></md-circular-progress>
                                      <p>${this.getSummaryProgressText()}</p>
                                  </div>
                              `
                            : this.summaryText
                              ? html`
                                    <div class="summary-body">
                                        ${safeHTML(
                                            marked.parse(this.summaryText, {
                                                async: false,
                                                breaks: true,
                                                gfm: true,
                                            }) as string,
                                        )}
                                    </div>
                                `
                              : !this.isSummaryModelReady
                                ? html`
                                      <div class="summary-notice">
                                          <p>${t('playerSummaryModelNotReady')}</p>
                                      </div>
                                  `
                                : !this.hasTranscription
                                  ? html`
                                        <div class="summary-notice">
                                            <p>${t('playerSummaryNoTranscription')}</p>
                                        </div>
                                    `
                                  : html`
                                        <div class="summary-notice">
                                            <p>${t('playerStartSummary')}</p>
                                        </div>
                                    `
                    }
                </div>
                <div slot="actions">
                    ${
                        this.isSummarizing
                            ? html`
                                  <md-text-button @click=${this.closeSummaryDialog}> ${t('alertOk')} </md-text-button>
                              `
                            : this.summaryText
                              ? html`
                                    <md-text-button @click=${this.startSummary}>
                                        <md-icon slot="icon">refresh</md-icon>
                                        ${t('playerSummaryRegenerate')}
                                    </md-text-button>
                                    <md-filled-tonal-button @click=${this.copySummary}>
                                        <md-icon slot="icon">${this.summaryCopied ? 'check' : 'content_copy'}</md-icon>
                                        ${this.summaryCopied ? t('playerSummaryCopied') : t('playerSummaryCopy')}
                                    </md-filled-tonal-button>
                                    <md-text-button @click=${this.closeSummaryDialog}> ${t('alertOk')} </md-text-button>
                                `
                              : !this.isSummaryModelReady
                                ? html`
                                      <md-filled-button @click=${this.openSettingsForSummary}>
                                          <md-icon slot="icon">settings</md-icon>
                                          ${t('playerOpenSettings')}
                                      </md-filled-button>
                                      <md-text-button @click=${this.closeSummaryDialog}>
                                          ${t('confirmCancelButton')}
                                      </md-text-button>
                                  `
                                : !this.hasTranscription
                                  ? html`
                                        <md-text-button @click=${this.closeSummaryDialog}>
                                            ${t('alertOk')}
                                        </md-text-button>
                                    `
                                  : html`
                                        <md-filled-button @click=${this.startSummary}>
                                            <md-icon slot="icon">auto_awesome</md-icon>
                                            ${t('playerStartSummary')}
                                        </md-filled-button>
                                        <md-text-button @click=${this.closeSummaryDialog}>
                                            ${t('confirmCancelButton')}
                                        </md-text-button>
                                    `
                    }
                </div>
            </md-dialog>
        `
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-player': Player
    }
}
