import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { formatFileSize, checkFileHandlePermission } from './util'
import '@material/web/list/list'
import '@material/web/list/list-item'
import '@material/web/divider/divider'
import '@material/web/icon/icon'
import '@material/web/iconbutton/filled-icon-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/chips/chip-set'
import '@material/web/chips/assist-chip'
import '@material/web/dialog/dialog'
import type { MdDialog } from '@material/web/dialog/dialog'
import '@material/web/button/text-button'
import '@material/web/progress/linear-progress'
import { MdCheckbox } from '@material/web/checkbox/checkbox'
import { MdFilterChip } from '@material/web/chips/filter-chip'
import Confirm from './confirm'
import Alert from './alert'
import type { ShowDirectoryPickerOptions } from '../type'
import { Message, SaveConfigSyncMessage, RequestRecordingStateMessage } from '../message'
import { sendException } from '../sentry'
import { recordingApi } from '../api_client'
import { Settings } from './settings'
import { Configuration, RecordingSortOrder } from '../configuration'
import { formatElapsedTime } from '../format'
import { t } from '../i18n'
import type { SubFileInfo } from '../recording_db'

export interface RecordEntry {
    title: string
    /** OPFS file path – stable identifier for download/delete operations */
    path: string
    size: number
    selected: boolean
    recordedAt?: Date
    isRecording: boolean
    isCanceled: boolean
    durationMs?: number | null
    subFiles: SubFileInfo[] // Related audio separation files from IndexedDB
    subFilesSize: number // Total size of sub-files in bytes
    thumbnailFileName?: string
    hasTranscription?: boolean
    hasSummary?: boolean
}

/**
 * Get the API URL for a recording file
 */
function getRecordingFileUrl(title: string): string {
    return `/api/recordings/${encodeURIComponent(title)}`
}

function isSelected(record: RecordEntry): boolean {
    return record.selected
}

@customElement('record-list')
export class RecordList extends LitElement {
    static override readonly styles = css`
        md-list {
            --md-list-container-color: var(--theme-surface, #f4fbfa);
            --md-list-item-label-text-color: var(--theme-text, #161d1d);
            --md-list-item-supporting-text-color: var(--theme-text-secondary, #3f4948);
            --md-list-item-trailing-supporting-text-color: var(--theme-text-secondary, #3f4948);
            --md-list-item-label-text-font: system-ui;
            --md-list-item-supporting-text-font: system-ui;
            --md-list-item-trailing-supporting-text-font: system-ui;
        }
        .meta {
            display: flex;
            align-items: center;
            color: var(--theme-text-secondary, inherit);
        }
        .meta > md-icon {
            padding: 1px 2px 1px 0;
        }

        .storage-heading {
            height: 40px;
            line-height: 40px;
            color: var(--theme-text, inherit);
        }
        .selected-actions {
            margin: 1em 0;
        }
        .sort-chip {
            min-width: 90px;
        }
        .list-item {
            font-variant-numeric: tabular-nums;
        }
        .start-slot {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .list-item md-checkbox {
            margin: 0;
        }
        .recording-title {
            height: 30px;
        }
        .recording {
            color: var(--theme-recording, #d93025);
        }
        .canceled {
            color: var(--theme-text-secondary, #3f4948);
        }
        .elapsed-time {
            margin-left: 0.25em;
        }
        .elapsed-blink {
            animation: blink 1s step-end infinite;
        }
        @keyframes blink {
            50% {
                visibility: hidden;
            }
        }
        @media (prefers-reduced-motion: reduce) {
            .elapsed-blink {
                animation: none;
            }
        }
        .sub-file-icon {
            color: var(--theme-text-secondary, #3f4948);
            margin-left: 4px;
            vertical-align: middle;
        }
        .separated-size {
            margin-left: 0.25em;
        }
        a {
            color: var(--theme-link, inherit);
        }
        .item-content {
            flex: 1;
            min-width: 0;
        }
        .thumbnail-container {
            width: 192px;
            height: 108px;
            border-radius: 4px;
            flex-shrink: 0;
            overflow: hidden;
            position: relative;
        }
        .cc-badge {
            position: absolute;
            top: 6px;
            left: 6px;
            background: rgba(0, 0, 0, 0.75);
            color: #ffffff;
            font-size: 0.6875rem;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 3px;
            letter-spacing: 0.05em;
            pointer-events: none;
            line-height: 1;
            border: 1px solid rgba(255, 255, 255, 0.4);
            z-index: 1;
        }
        .thumbnail-container img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .thumbnail-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--theme-surface-variant, #dae5e3);
            color: var(--theme-text-secondary, #3f4948);
            font-size: 0.875rem;
        }
        .thumbnail-recording {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--theme-surface-variant, #dae5e3);
            color: var(--theme-recording, #d93025);
            font-size: 0.875rem;
            font-weight: 500;
        }
        md-dialog {
            --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high));
        }
        .download-dialog-content {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 360px;
        }
        .download-filename {
            margin: 0;
            font-size: 0.875rem;
            color: var(--theme-text, inherit);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .download-status {
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
            color: var(--theme-text-secondary, #3f4948);
            font-variant-numeric: tabular-nums;
        }
    `

    private static readonly dateTimeFormat = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

    private static readonly uiLanguage = chrome?.i18n?.getMessage?.('@@ui_locale')?.startsWith?.('ja') ? 'ja' : 'en'
    private static readonly pluralRules = new Intl.PluralRules(RecordList.uiLanguage)
    private static formatRecordCount(count: number): string {
        const category = RecordList.pluralRules.select(count)
        const key = category === 'one' ? 'recordListRecordCountOne' : 'recordListRecordCountOther'
        return t(key, count.toString())
    }

    @property({ type: Array })
    private records: Array<RecordEntry>

    @property()
    private sortOrder: RecordingSortOrder

    @state()
    private elapsedTimeText: string = formatElapsedTime(0)

    @state()
    private timerStopText: string = ''

    @state()
    private failedThumbnailKeys: Set<string> = new Set()

    @state()
    private fetchError: boolean = false

    @state()
    private isDownloading: boolean = false

    @state()
    private downloadProgressValue: number = 0

    @state()
    private downloadCurrentFile: string = ''

    @state()
    private downloadCompletedFiles: number = 0

    @state()
    private downloadTotalFiles: number = 0

    @state()
    private downloadLoadedBytes: number = 0

    @state()
    private downloadTotalBytes: number = 0

    private downloadAbortController: AbortController | null = null

    private recordingStartAtMs: number | null = null
    private recordingStopAtMs: number | null = null
    private recordingPaused: boolean = false
    private recordingTotalPausedMs: number = 0
    private elapsedTimerId?: ReturnType<typeof setInterval>

    public constructor() {
        super()
        this.records = []
        this.sortOrder = Settings.getConfiguration().recordingSortOrder
    }

    override connectedCallback() {
        super.connectedCallback()
        chrome.runtime.onMessage.addListener(this.handleMessage)
        ;(async () => {
            await this.updateRecord()
            this.syncElapsedTimer()
            await this.checkStoredRecordingError()
            // Request current recording state to get accurate pause info
            const msg: RequestRecordingStateMessage = { type: 'request-recording-state' }
            await chrome.runtime.sendMessage(msg)
        })().catch(e => {
            console.error(e)
            sendException(e, { exceptionSource: 'option.recordList.connectedCallback' })
        })
    }

    override disconnectedCallback() {
        super.disconnectedCallback()
        chrome.runtime.onMessage.removeListener(this.handleMessage)
        this.stopElapsedTimer()
    }

    // NOTE: Must not return true or a truthy value (e.g. Promise from async function)
    // to avoid interfering with sendMessage responses from other contexts.
    private handleMessage = (message: Message) => {
        if (message.type === 'transcription-complete') {
            const target = this.records.find(r => r.path === message.path)
            if (target) {
                recordingApi
                    .getTranscription(message.path)
                    .then(transcription => {
                        const oldVal = [...this.records]
                        target.hasTranscription = (transcription?.segments?.length ?? 0) > 0
                        this.requestUpdate('records', oldVal)
                    })
                    .catch(e => {
                        console.error('Failed to check transcription segments:', e)
                    })
            }
            return
        }
        if (message.type === 'transcription-deleted') {
            const target = this.records.find(r => r.path === message.path)
            if (target) {
                const oldVal = [...this.records]
                target.hasTranscription = false
                this.requestUpdate('records', oldVal)
            }
            return
        }
        if (message.type === 'summary-complete') {
            const target = this.records.find(r => r.path === message.path)
            if (target) {
                const oldVal = [...this.records]
                target.hasSummary = (message.summary.text?.length ?? 0) > 0
                this.requestUpdate('records', oldVal)
            }
            return
        }
        if (message.type === 'summary-deleted') {
            const target = this.records.find(r => r.path === message.path)
            if (target) {
                const oldVal = [...this.records]
                target.hasSummary = false
                this.requestUpdate('records', oldVal)
            }
            return
        }
        if (message.type !== 'recording-state') return
        ;(async () => {
            const recordingState = message.data
            if (recordingState.isRecording && recordingState.startAtMs != null) {
                this.recordingTotalPausedMs = recordingState.totalPausedMs ?? 0
                if (recordingState.isPaused) {
                    this.recordingPaused = true
                    this.pauseElapsedTimer(recordingState.startAtMs)
                } else {
                    this.recordingPaused = false
                    this.startElapsedTimer(recordingState.startAtMs)
                }
                this.recordingStopAtMs = recordingState.stopAtMs ?? null
                this.updateTimerStopText()
            } else {
                this.stopElapsedTimer()
            }
            await this.updateRecord()
            await this.checkStoredRecordingError()
        })().catch(e => {
            console.error(e)
            sendException(e, { exceptionSource: 'option.recordList.onMessage' })
        })
    }

    private async checkStoredRecordingError() {
        try {
            const result = await chrome.storage.local.get('lastRecordingError')
            const lastRecordingError = result.lastRecordingError as string | undefined
            if (lastRecordingError) {
                await chrome.storage.local.remove('lastRecordingError')
                RecordList.showRecordingError(lastRecordingError)
            }
        } catch (e) {
            console.error(e)
            sendException(e, { exceptionSource: 'option.recordList.checkStoredRecordingError' })
        }
    }

    private static showRecordingError(error: string) {
        const alertDialog = document.getElementById('alert-dialog') as Alert | null
        if (alertDialog == null) return
        alertDialog.setContent(t('recordListRecordingFailed'), error, { preformatted: true })
        const dialog = alertDialog.shadowRoot?.querySelector('md-dialog') as MdDialog | null
        dialog?.show()
    }

    private static getThumbnailKey(record: Pick<RecordEntry, 'path' | 'thumbnailFileName'>): string | null {
        if (!record.thumbnailFileName) return null
        return `${record.path}::${record.thumbnailFileName}`
    }

    private hasThumbnailLoadFailed(record: Pick<RecordEntry, 'path' | 'thumbnailFileName'>): boolean {
        const key = RecordList.getThumbnailKey(record)
        return key != null && this.failedThumbnailKeys.has(key)
    }

    private handleThumbnailError(record: Pick<RecordEntry, 'path' | 'thumbnailFileName'>) {
        const key = RecordList.getThumbnailKey(record)
        if (key == null || this.failedThumbnailKeys.has(key)) return
        const next = new Set(this.failedThumbnailKeys)
        next.add(key)
        this.failedThumbnailKeys = next
    }

    public override render() {
        const row = (record: RecordEntry, idx: number) => {
            const fileUrl = getRecordingFileUrl(record.path)
            const downloadUrl = `${fileUrl}?download=true`
            return html` ${idx > 0 ? html`<md-divider></md-divider>` : ''}
                <md-list-item class="list-item">
                    <div slot="start" class="start-slot">
                        <md-checkbox
                            touch-target="wrapper"
                            ?disabled=${record.isRecording}
                            ?checked=${record.selected}
                            @input=${this.selectRecord(record)}></md-checkbox>
                        <div class="thumbnail-container">
                            ${
                                record.hasTranscription
                                    ? html`<span class="cc-badge" title="${t('recordListHasTranscription')}">CC</span>`
                                    : ''
                            }
                            ${
                                record.isRecording
                                    ? html`<div class="thumbnail-recording">${t('recordListThumbnailRecording')}</div>`
                                    : record.thumbnailFileName && !this.hasThumbnailLoadFailed(record)
                                      ? html`<img
                                            src="${getRecordingFileUrl(record.thumbnailFileName)}"
                                            alt=""
                                            loading="lazy"
                                            @error=${() => this.handleThumbnailError(record)} />`
                                      : html`<div class="thumbnail-placeholder">
                                            ${t('recordListThumbnailUnavailable')}
                                        </div>`
                            }
                        </div>
                    </div>
                    <div class="recording-title" slot="headline">
                        ${
                            record.isRecording
                                ? html`<span aria-disabled="true">${record.title}</span>`
                                : html`<a href="${downloadUrl}">${record.title}</a>`
                        }
                        ${
                            record.isRecording
                                ? ''
                                : record.subFiles.map(sub => {
                                      const subUrl = `${getRecordingFileUrl(sub.path)}?download=true`
                                      const label =
                                          sub.type === 'tab' ? t('recordListTabAudio') : t('recordListMicAudio')
                                      const icon = sub.type === 'tab' ? 'headphones' : 'mic'
                                      return html`<a
                                          href="${subUrl}"
                                          title="${label}"
                                          aria-label="${t('recordListDownloadLabel', label)}"
                                          class="sub-file-icon"
                                          ><md-icon>${icon}</md-icon></a
                                      >`
                                  })
                        }
                    </div>
                    <div class="item-content" slot="supporting-text">
                        <div class="meta" title=${t('recordListTitleFileSize')}>
                            <md-icon>storage</md-icon> ${formatFileSize(record.size + record.subFilesSize)}
                            ${
                                record.subFilesSize > 0
                                    ? html` <span class="separated-size" title=${t('recordListTitleSeparatedSize')}
                                          >(${t('recordListSeparatedSize', formatFileSize(record.subFilesSize))})</span
                                      >`
                                    : ''
                            }
                        </div>
                        ${
                            record.recordedAt != null
                                ? html`<div class="meta" title=${t('recordListTitleRecordedAt')}>
                                      <md-icon>schedule</md-icon>
                                      ${RecordList.dateTimeFormat.format(record.recordedAt)}
                                  </div>`
                                : ''
                        }
                        ${
                            record.durationMs != null && !record.isRecording
                                ? html`<div class="meta" title=${t('recordListTitleDuration')}>
                                      <md-icon>timer</md-icon> ${formatElapsedTime(record.durationMs)}
                                  </div>`
                                : ''
                        }
                        ${
                            record.isRecording
                                ? html`<div class="meta recording" title=${t('recordListTitleRecording')}>
                                      <md-icon>screen_record</md-icon>
                                      ${this.recordingPaused ? t('recordListPaused') : t('recordListRecording')}
                                      <span class="elapsed-time${this.recordingPaused ? ' elapsed-blink' : ''}"
                                          >${this.elapsedTimeText}</span
                                      >${
                                          this.timerStopText
                                              ? html` <span title=${t('recordListTitleTimerStop')}
                                                    >(⏱
                                                    ${
                                                        this.recordingPaused
                                                            ? t('recordListTimerPaused')
                                                            : t('recordListTimerStopsAt', this.timerStopText)
                                                    })</span
                                                >`
                                              : ''
                                      }
                                  </div>`
                                : ''
                        }
                        ${
                            record.isCanceled
                                ? html`<div class="meta canceled" title=${t('recordListTitleCanceled')}>
                                      <md-icon>cancel</md-icon> ${t('recordListCanceled')}
                                  </div>`
                                : ''
                        }
                    </div>
                    <md-filled-icon-button
                        slot="end"
                        ?disabled=${record.isRecording || record.isCanceled}
                        @click=${this.playRecord(record)}>
                        <md-icon>play_arrow</md-icon>
                    </md-filled-icon-button>
                </md-list-item>`
        }
        const totalSize = this.records.reduce((sum, r) => sum + r.size + r.subFilesSize, 0)
        const sortIcon = this.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'
        const sortLabel = this.sortOrder === 'asc' ? t('recordListSortAsc') : t('recordListSortDesc')
        const countLabel = RecordList.formatRecordCount(this.records.length)
        return html` <h2 class="storage-heading">${t('recordListStorage', [countLabel, formatFileSize(totalSize)])}</h2>
            <md-chip-set class="selected-actions">
                <md-filter-chip
                    label=${t('recordListSelectAll')}
                    has-icon="true"
                    ?disabled=${this.records.length === 0}
                    ?selected=${this.records.length > 0 && this.records.every(isSelected)}
                    @click=${this.selectAll}>
                    <md-icon slot="icon">check_box_outline_blank</md-icon>
                </md-filter-chip>
                <md-assist-chip class="sort-chip" label="${sortLabel}" has-icon="true" @click=${this.toggleSortOrder}>
                    <md-icon slot="icon">${sortIcon}</md-icon>
                </md-assist-chip>
                <md-assist-chip
                    label=${t('recordListSave')}
                    ?disabled=${!this.records.some(isSelected)}
                    @click=${this.saveSelectedRecords}>
                    <md-icon slot="icon">save</md-icon>
                </md-assist-chip>
                <md-assist-chip
                    label=${t('recordListDelete')}
                    ?disabled=${!this.records.some(isSelected)}
                    @click=${this.deleteSelectedRecords}>
                    <md-icon slot="icon">delete</md-icon>
                </md-assist-chip>
            </md-chip-set>
            <md-list>
                ${
                    this.fetchError
                        ? html`<md-list-item style="--md-list-item-label-text-color: var(--theme-error, #b00020)">
                              ${t('recordListFetchError')}
                          </md-list-item>`
                        : this.records.length === 0
                          ? html`<md-list-item>${t('recordListNoEntry')}</md-list-item>`
                          : repeat(this.records, record => record.path, row)
                }
            </md-list>
            <md-dialog
                id="download-dialog"
                .open=${this.isDownloading}
                @cancel=${this.handleDownloadDialogCancel}
                @keydown=${this.handleDownloadDialogKeydown}>
                <div slot="headline">${t('recordListDownloadTitle')}</div>
                <md-icon slot="icon">download</md-icon>
                <div slot="content" class="download-dialog-content">
                    <p class="download-filename">${this.downloadCurrentFile}</p>
                    <md-linear-progress
                        .value=${this.downloadProgressValue}
                        ?indeterminate=${this.downloadTotalBytes === 0}>
                    </md-linear-progress>
                    <div class="download-status">
                        <span
                            >${t('recordListDownloadProgressFiles', [this.downloadCompletedFiles.toString(), this.downloadTotalFiles.toString()])}</span
                        >
                        <span
                            >${formatFileSize(this.downloadLoadedBytes)} /
                            ${formatFileSize(this.downloadTotalBytes)}</span
                        >
                    </div>
                </div>
                <div slot="actions">
                    <md-text-button @click=${this.cancelDownload}> ${t('recordListDownloadCancel')} </md-text-button>
                </div>
            </md-dialog>`
    }

    private removeRecord(record: RecordEntry) {
        this.records = this.records.filter(r => r.path !== record.path)
    }
    private async updateRecord() {
        let recordings: Awaited<ReturnType<typeof recordingApi.listRecordings>>
        try {
            // Fetch recordings from API (now backed by IndexedDB, sub-files already grouped)
            recordings = await recordingApi.listRecordings({ sort: this.sortOrder })
        } catch (e) {
            console.error('Failed to fetch recordings:', e)
            sendException(e, { exceptionSource: 'option.recordList.updateRecord' })
            const oldVal = [...this.records]
            this.fetchError = true
            this.records = []
            if (this.failedThumbnailKeys.size > 0) {
                this.failedThumbnailKeys = new Set()
            }
            this.requestUpdate('records', oldVal)
            return
        }
        this.fetchError = false

        const result: Array<RecordEntry> = recordings.map(meta => ({
            title: meta.title,
            path: meta.path ?? meta.title,
            size: meta.size,
            selected: false,
            recordedAt: meta.recordedAt != null ? new Date(meta.recordedAt) : undefined,
            isRecording: meta.isRecording ?? false,
            isCanceled: meta.status === 'canceled',
            durationMs: meta.durationMs,
            subFiles: meta.subFiles ?? [],
            subFilesSize: meta.subFilesSize ?? 0,
            thumbnailFileName: meta.thumbnailFileName,
            hasTranscription: meta.hasTranscription ?? false,
            hasSummary: meta.hasSummary ?? false,
        }))

        const oldVal = [...this.records]
        this.records = result
        const validThumbnailKeys = new Set(
            result.map(r => RecordList.getThumbnailKey(r)).filter((key): key is string => key != null),
        )
        if (this.failedThumbnailKeys.size > 0) {
            const retainedFailedKeys = new Set([...this.failedThumbnailKeys].filter(key => validThumbnailKeys.has(key)))
            if (retainedFailedKeys.size !== this.failedThumbnailKeys.size) {
                this.failedThumbnailKeys = retainedFailedKeys
            }
        }
        this.requestUpdate('records', oldVal)
    }

    private syncElapsedTimer() {
        const recordingEntry = this.records.find(r => r.isRecording && r.recordedAt)
        if (recordingEntry?.recordedAt) {
            this.startElapsedTimer(recordingEntry.recordedAt.getTime())
        }
    }

    private startElapsedTimer(startAtMs: number) {
        if (this.recordingStartAtMs === startAtMs && this.elapsedTimerId != null) return
        if (this.elapsedTimerId != null) {
            clearInterval(this.elapsedTimerId)
            this.elapsedTimerId = undefined
        }
        this.recordingStartAtMs = startAtMs
        this.updateElapsedTime()
        this.elapsedTimerId = setInterval(() => this.updateElapsedTime(), 1000)
    }

    private pauseElapsedTimer(startAtMs: number) {
        if (this.elapsedTimerId != null) {
            clearInterval(this.elapsedTimerId)
            this.elapsedTimerId = undefined
        }
        this.recordingStartAtMs = startAtMs
        this.updateElapsedTime()
    }

    private stopElapsedTimer() {
        if (this.elapsedTimerId != null) {
            clearInterval(this.elapsedTimerId)
            this.elapsedTimerId = undefined
        }
        this.recordingStartAtMs = null
        this.recordingStopAtMs = null
        this.recordingPaused = false
        this.recordingTotalPausedMs = 0
        this.elapsedTimeText = ''
        this.timerStopText = ''
    }

    private updateElapsedTime() {
        if (this.recordingStartAtMs == null) return
        const elapsed = Date.now() - this.recordingStartAtMs - this.recordingTotalPausedMs
        this.elapsedTimeText = formatElapsedTime(elapsed)
        this.updateTimerStopText()
    }

    private updateTimerStopText() {
        if (this.recordingStopAtMs == null) {
            this.timerStopText = ''
            return
        }
        this.timerStopText = new Date(this.recordingStopAtMs).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        })
    }
    private async toggleSortOrder() {
        const newOrder: RecordingSortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'
        this.sortOrder = newOrder

        // Save to configuration
        const config = Settings.getConfiguration()
        config.recordingSortOrder = newOrder
        Settings.setConfiguration(config)

        // Sync to remote storage
        const msg: SaveConfigSyncMessage = {
            type: 'save-config-sync',
            data: Configuration.filterForSync(config),
        }
        await chrome.runtime.sendMessage(msg)

        // Refresh the list with new sort order
        await this.updateRecord()
    }
    private playRecord(record: RecordEntry) {
        return () => {
            const playerUrl = chrome.runtime.getURL('player.html') + `?path=${encodeURIComponent(record.path ?? '')}`
            window.open(playerUrl, '_blank', 'popup=true,width=1200,height=760')
        }
    }
    private selectRecord(record: RecordEntry) {
        return (e: Event) => {
            if (!(e.target instanceof MdCheckbox)) return
            const oldVal = [...this.records]
            record.selected = e.target.checked
            this.requestUpdate('records', oldVal)
        }
    }
    private selectAll(e: Event) {
        if (!(e.target instanceof MdFilterChip)) return
        const selected = e.target.selected
        const oldVal = [...this.records]
        this.records = this.records.map(record => {
            if (record.isRecording) return record // ignore recording entry
            record.selected = selected
            return record
        })
        this.requestUpdate('records', oldVal)
    }
    private handleDownloadDialogCancel(e: Event) {
        e.preventDefault()
    }

    private handleDownloadDialogKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
        }
    }

    private cancelDownload() {
        this.downloadAbortController?.abort()
        this.isDownloading = false
    }

    private static showSaveError(error: unknown) {
        const alertDialog = document.getElementById('alert-dialog') as Alert | null
        if (alertDialog == null) return
        const message = error instanceof Error ? error.message : String(error)
        alertDialog.setContent(t('recordListDownloadFailed'), message, { preformatted: true })
        const dialog = alertDialog.shadowRoot?.querySelector('md-dialog') as MdDialog | null
        dialog?.show()
    }

    private async saveSelectedRecords() {
        if (this.downloadAbortController != null) return
        const selectedRecords = this.records.filter(isSelected)
        if (selectedRecords.length === 0) return
        let dirHandle: FileSystemDirectoryHandle
        try {
            const options: ShowDirectoryPickerOptions = {
                id: 'save-directory',
                mode: 'readwrite',
                startIn: 'downloads',
            }
            dirHandle = await window.showDirectoryPicker(options)
            const permission = await checkFileHandlePermission(dirHandle)
            if (!permission) {
                throw new Error('permission denied')
            }
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') {
                return
            }
            console.error('Failed to get directory handle:', e)
            RecordList.showSaveError(e)
            return
        }

        interface DownloadFileItem {
            fileName: string
            url: string
            size: number
        }

        const items: DownloadFileItem[] = []

        for (const record of selectedRecords) {
            const baseName = record.path.replace(/\.[^.]+$/, '')

            // 1. Main recording file
            items.push({
                fileName: record.path,
                url: `/api/recordings/${encodeURIComponent(record.path)}?download=true`,
                size: record.size,
            })

            // 2. Sub-files (audio separation)
            for (const subFile of record.subFiles) {
                items.push({
                    fileName: subFile.path,
                    url: `/api/recordings/${encodeURIComponent(subFile.path)}?download=true`,
                    size: subFile.fileSize,
                })
            }

            // 3. Transcription (if present)
            if (record.hasTranscription) {
                const vttUrl = `/api/recordings/${encodeURIComponent(record.path)}/transcription.vtt?download=true`
                const size = await recordingApi.getContentLength(vttUrl)
                if (size != null && size > 0) {
                    items.push({
                        fileName: `${baseName}.vtt`,
                        url: vttUrl,
                        size,
                    })
                }
            }

            // 4. Summary (if present)
            if (record.hasSummary) {
                const summaryUrl = `/api/recordings/${encodeURIComponent(record.path)}/summary.md?download=true`
                const size = await recordingApi.getContentLength(summaryUrl)
                if (size != null && size > 0) {
                    items.push({
                        fileName: `${baseName}-summary.md`,
                        url: summaryUrl,
                        size,
                    })
                }
            }
        }

        const abortController = new AbortController()
        this.downloadAbortController = abortController
        const signal = abortController.signal

        this.downloadTotalFiles = items.length
        this.downloadCompletedFiles = 0
        this.downloadLoadedBytes = 0
        this.downloadTotalBytes = items.reduce((acc, item) => acc + item.size, 0)
        this.downloadProgressValue = 0
        this.downloadCurrentFile = items[0]?.fileName ?? ''
        this.isDownloading = true

        let loadedBytes = 0
        let lastUpdateTime = 0
        const PROGRESS_THROTTLE_MS = 100

        const updateProgress = (force = false) => {
            const now = performance.now()
            if (force || now - lastUpdateTime >= PROGRESS_THROTTLE_MS) {
                lastUpdateTime = now
                this.downloadLoadedBytes = loadedBytes
                if (this.downloadTotalBytes > 0) {
                    this.downloadProgressValue = Math.min(1, loadedBytes / this.downloadTotalBytes)
                }
            }
        }

        try {
            for (const item of items) {
                if (signal.aborted) break

                this.downloadCurrentFile = item.fileName
                const stream = await recordingApi.getFileStream(item.url, signal)
                if (signal.aborted) break
                if (!stream) {
                    throw new Error(`Failed to download file: ${item.fileName}`)
                }

                const fileHandle = await dirHandle.getFileHandle(item.fileName, { create: true })
                const writableStream = await fileHandle.createWritable()

                try {
                    const countStream = new TransformStream<Uint8Array, Uint8Array>({
                        transform: (chunk, controller) => {
                            loadedBytes += chunk.byteLength
                            updateProgress()
                            controller.enqueue(chunk)
                        },
                    })

                    await stream.pipeThrough(countStream).pipeTo(writableStream, { signal })
                    updateProgress(true)
                } catch (e) {
                    try {
                        await writableStream.abort()
                    } catch {
                        // ignore
                    }
                    if (signal.aborted) {
                        break
                    }
                    throw e
                }

                this.downloadCompletedFiles++
            }

            if (!signal.aborted) {
                updateProgress(true)
                this.downloadProgressValue = 1
                this.downloadLoadedBytes = this.downloadTotalBytes
            }
        } catch (e) {
            console.error('Error during batch download:', e)
            sendException(e, { exceptionSource: 'option.recordList.saveSelectedRecords' })
            RecordList.showSaveError(e)
        } finally {
            this.isDownloading = false
            this.downloadAbortController = null
        }
    }
    private deleteSelectedRecords() {
        const dialogWrapper = document.getElementById('confirm-dialog') as Confirm
        const selectedRecords = this.records.filter(isSelected)
        dialogWrapper.setRecords(selectedRecords)

        if (dialogWrapper.shadowRoot == null) return
        const dialog = dialogWrapper.shadowRoot.children[0] as MdDialog
        const listener = async () => {
            dialog.removeEventListener('close', listener)

            console.log('confirm-dialog:', dialog.returnValue)
            if (dialog.returnValue === 'delete') {
                try {
                    await Promise.all(
                        selectedRecords.map(async record => {
                            console.log('Delete:', record.path)

                            // Cascade delete: server handles sub-files + IndexedDB record
                            await recordingApi.deleteRecording(record.path)
                            // remove from UI
                            this.removeRecord(record)
                        }),
                    )
                } catch (e) {
                    sendException(e, { exceptionSource: 'option.recordList.delete.dialog' })
                }
            }
            dialog.returnValue = ''
        }
        dialog.addEventListener('close', listener)
        dialog.show()
    }
}

export default RecordList

declare global {
    interface HTMLElementTagNameMap {
        'record-list': RecordList
    }
}
