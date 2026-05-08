import { v7 as uuidv7 } from 'uuid'

import type { getMediaStreamId } from './type'
import type {
    Trigger,
    StartTrigger,
    StartRecordingMessage,
    StartRecordingResponse,
    StopRecordingMessage,
    PauseRecordingMessage,
    ResumeRecordingMessage,
    SaveConfigLocalMessage,
    ExceptionMessage,
    RecordingStateMessage,
    CancelRecordingMessage,
    SentryEventMessage,
} from './message'
import { TIMER_STOP_CONFIRM_PENDING_KEY, TIMER_STOP_TRIGGER_KEY } from './message'
import { Configuration, Resolution } from './configuration'
import { ExtensionSyncStorage } from './storage'
import { deepMerge } from './element/util'
import { OPFSStorage } from './opfs_storage'
import { handleApiRequest, RecordingState } from './handler'
import { buildRecordingTitle } from './format'
import { createMessageListener, type ServiceWorkerDeps } from './service_worker_handler'
import { t } from './i18n'
import { RecordingDB } from './recording_db'

const recordingIcon = '/icons/recording.png'
const recordingVideoOnlyIcon = '/icons/recording-video-only.png'
const recordingAudioOnlyIcon = '/icons/recording-audio-only.png'
const notRecordingIcon = '/icons/not-recording.png'
const storage = new ExtensionSyncStorage()

const APP_NAME = t('appName')
const DEFAULT_TITLE = t('actionDefaultTitle')
const CONTEXT_MENU_ID = 'start-recording'
const CONTEXT_MENU_PAUSE_ID = 'pause-recording'

chrome.runtime.onInstalled.addListener(async () => {
    await createOffscreenDocument()

    const defaultConfig = new Configuration()
    const remoteConfig = await getRemoteConfiguration()
    // for backward compatibility
    if (remoteConfig != null && remoteConfig.screenRecordingSize.auto != true) {
        remoteConfig.screenRecordingSize.auto = false
    }
    const config = remoteConfig == null ? defaultConfig : deepMerge(defaultConfig, remoteConfig)
    if (config.userId === '') {
        config.userId = uuidv7()
    }
    Configuration.migrate(config, remoteConfig as unknown as Record<string, unknown>)
    await storage.set(Configuration.key, config)
    console.debug('config:', config)

    const msg: SaveConfigLocalMessage = {
        type: 'save-config-local',
        data: config as Configuration,
    }
    await chrome.runtime.sendMessage(msg)

    // Migrate existing OPFS recordings to IndexedDB (before closing offscreen for Sentry logging)
    try {
        const status = await recordingDB.needsMigration(recordingStorage)
        if (status.needed) {
            const sentryStart: SentryEventMessage = {
                type: 'sentry-event',
                event: {
                    type: 'migration_start',
                    metrics: {
                        opfsMainFileCount: status.opfsMainFileCount,
                        idbRecordCount: status.idbRecordCount,
                    },
                },
            }
            await chrome.runtime.sendMessage(sentryStart)
            const startTime = performance.now()
            const inserted = await recordingDB.migrateFromOPFS(recordingStorage)
            const durationMs = Math.round(performance.now() - startTime)
            const sentryEnd: SentryEventMessage = {
                type: 'sentry-event',
                event: {
                    type: 'migration_end',
                    metrics: { inserted, durationMs },
                },
            }
            await chrome.runtime.sendMessage(sentryEnd)
            console.info('IndexedDB migration completed', { inserted, durationMs })
        } else {
            console.debug('IndexedDB migration skipped (already up to date)')
        }
    } catch (e) {
        console.error('IndexedDB migration failed:', e)
    }

    await chrome.offscreen.closeDocument()

    // Create context menu for starting recording
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: t('contextMenuStartRecording'),
        contexts: ['page'],
    })

    // Create context menu for pause/resume (hidden by default)
    chrome.contextMenus.create({
        id: CONTEXT_MENU_PAUSE_ID,
        title: t('contextMenuPauseRecording'),
        contexts: ['page'],
        visible: false,
    })
})

async function getOffscreenDocument(): Promise<chrome.runtime.ExtensionContext | undefined> {
    const existingContexts = await chrome.runtime.getContexts({})
    return existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT')
}

async function createOffscreenDocument() {
    const offscreenDocument = await getOffscreenDocument()
    if (offscreenDocument) return

    // If an offscreen document is not already open, create one.
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Recording from chrome.tabCapture API',
    })
}

async function getIsRecording(): Promise<boolean> {
    const offscreenDocument = await getOffscreenDocument()
    return offscreenDocument?.documentUrl?.endsWith('#recording') ?? false
}

// Persistent recording state
const recordingStateKey = 'recordingState'
async function getRecordingState(): Promise<RecordingState> {
    const isRecording = await getIsRecording()
    if (!isRecording) return { isRecording }

    const recordingState = (await chrome.storage.local.get(recordingStateKey))[recordingStateKey]
    if (!recordingState) return { isRecording }

    return { ...recordingState, isRecording }
}
async function setRecordingState(state: RecordingState) {
    await chrome.storage.local.set({ [recordingStateKey]: state })
}

// Action icon handler
chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    const trigger = 'action-icon'
    try {
        if (await getIsRecording()) {
            await stopRecording(trigger)
            return
        }
        await startRecording(tab, trigger)
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    const trigger = 'context-menu'
    try {
        if (info.menuItemId === CONTEXT_MENU_PAUSE_ID) {
            const state = await getRecordingState()
            if (state.isRecording && state.isPaused) {
                await resumeRecording(trigger)
            } else if (state.isRecording) {
                await pauseRecording(trigger)
            }
            return
        }
        if (info.menuItemId !== CONTEXT_MENU_ID || !tab) return
        if (await getIsRecording()) {
            await stopRecording(trigger)
            return
        }
        await startRecording(tab, trigger)
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

// Keyboard shortcut handler
chrome.commands.onCommand.addListener(async (command: string, tab?: chrome.tabs.Tab) => {
    const trigger = 'keyboard-shortcut'
    try {
        switch (command) {
            case 'start-recording': {
                if (!tab) return
                if (await getIsRecording()) return
                await startRecording(tab, trigger)
                break
            }
            case 'stop-recording': {
                if (!(await getIsRecording())) return
                await stopRecording(trigger)
                break
            }
            case 'toggle-recording': {
                if (await getIsRecording()) {
                    await stopRecording(trigger)
                    return
                }
                if (!tab) return
                await startRecording(tab, trigger)
                break
            }
            case 'toggle-pause-recording': {
                const state = await getRecordingState()
                if (!state.isRecording) return
                if (state.isPaused) {
                    await resumeRecording(trigger)
                } else {
                    await pauseRecording(trigger)
                }
                break
            }
            case 'open-option-page': {
                await chrome.runtime.openOptionsPage()
                break
            }
        }
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

async function startRecording(tab: chrome.tabs.Tab, trigger: StartTrigger) {
    await createOffscreenDocument()

    // Get a MediaStream for the active tab.
    const streamId = await (chrome.tabCapture.getMediaStreamId as typeof getMediaStreamId)({
        targetTabId: tab.id,
    })

    // Track screen size for preview functionality
    const screenSize = { width: tab.width ?? 0, height: tab.height ?? 0 }

    // Send the stream ID to the offscreen document to start recording.
    const msg: StartRecordingMessage = {
        type: 'start-recording',
        trigger,
        data: {
            tabSize: screenSize,
            streamId,
        },
    }
    const response: StartRecordingResponse | undefined = await chrome.runtime.sendMessage(msg)
    if (response == null) {
        throw new Error('unexpected start recording response')
    }

    // Set recording state from offscreen response
    await setRecordingState({
        isRecording: true,
        screenSize,
        startAtMs: response.startAtMs,
        recordingMode: response.recordingMode,
        micEnabled: response.micEnabled,
        stopAtMs: response.stopAtMs,
    })

    await updateRecordingIndications()
    await broadcastRecordingState()
}

async function stopRecording(trigger: Trigger, skipConfirmation = false) {
    // Check if timer confirmation is needed
    if (!skipConfirmation) {
        const config = await getConfiguration()
        if (config.recordingTimer.enabled && !config.recordingTimer.skipStopConfirmation) {
            const state = await getRecordingState()
            if (state.isRecording && state.stopAtMs != null) {
                // Timer is active: open option page for confirmation instead of stopping
                await chrome.storage.local.set({
                    [TIMER_STOP_CONFIRM_PENDING_KEY]: true,
                    [TIMER_STOP_TRIGGER_KEY]: trigger,
                })
                await chrome.runtime.openOptionsPage()
                return
            }
        }
    }

    // Send stop-recording message to offscreen document
    const msg: StopRecordingMessage = {
        type: 'stop-recording',
        trigger,
    }
    await chrome.runtime.sendMessage(msg)

    await broadcastRecordingState()
    await updateRecordingIndications()

    // Open option page if need
    const config = await getConfiguration()
    if (config.openOptionPage) await chrome.runtime.openOptionsPage()

    // Close offscreen document
    await chrome.offscreen.closeDocument()
}

async function cancelRecording(error: string) {
    // Send cancel-recording message to offscreen document
    const msg: CancelRecordingMessage = { type: 'cancel-recording' }
    await chrome.runtime.sendMessage(msg)

    // Persist error BEFORE broadcasting state so that the option page
    // (if already open) can read it when handling the recording-state message.
    if (error !== '') {
        await chrome.storage.local.set({ lastRecordingError: error })
    }

    await broadcastRecordingState()
    await updateRecordingIndications()

    // Close offscreen document
    await chrome.offscreen.closeDocument()

    if (error === '') return
    // Open option page to show the error
    await chrome.runtime.openOptionsPage()
}

async function pauseRecording(trigger: Trigger) {
    const msg: PauseRecordingMessage = { type: 'pause-recording', trigger }
    await chrome.runtime.sendMessage(msg)

    const state = await getRecordingState()
    await setRecordingState({ ...state, isPaused: true, pausedAtMs: Date.now() })
    await updateRecordingIndications()
    await broadcastRecordingState()
}

async function resumeRecording(trigger: Trigger) {
    const msg: ResumeRecordingMessage = { type: 'resume-recording', trigger }
    await chrome.runtime.sendMessage(msg)

    const state = await getRecordingState()
    const pausedDuration = state.pausedAtMs != null ? Date.now() - state.pausedAtMs : 0
    const totalPausedMs = (state.totalPausedMs ?? 0) + pausedDuration
    await setRecordingState({ ...state, isPaused: false, pausedAtMs: undefined, totalPausedMs })
    await updateRecordingIndications()
    await broadcastRecordingState()
}

async function updateRecordingIndications() {
    try {
        const state = await getRecordingState()
        await updateActionIcon(state)
        await updateActionTitle(state)
        await updateContextMenuTitle(state)
        await updateBadge(state)
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
}

async function updateActionIcon(state: RecordingState) {
    let path = notRecordingIcon
    if (state.isRecording) {
        // Set recording icon based on recording mode
        switch (state.recordingMode) {
            case 'video-only':
                path = recordingVideoOnlyIcon
                break
            case 'audio-only':
                path = recordingAudioOnlyIcon
                break
            default:
                path = recordingIcon
                break
        }
    }
    await chrome.action.setIcon({ path })
}

async function updateActionTitle(state: RecordingState) {
    await chrome.action.setTitle({
        title: state.isRecording ? buildRecordingTitle(APP_NAME, state) : DEFAULT_TITLE,
    })
}

// Update context menu title based on recording state
async function updateContextMenuTitle(state: RecordingState) {
    await chrome.contextMenus.update(CONTEXT_MENU_ID, {
        title: state.isRecording ? t('contextMenuStopRecording') : t('contextMenuStartRecording'),
    })
    await chrome.contextMenus.update(CONTEXT_MENU_PAUSE_ID, {
        title: state.isPaused ? t('contextMenuResumeRecording') : t('contextMenuPauseRecording'),
        visible: state.isRecording,
    })
}

// Update badge to indicate paused state
async function updateBadge(state: RecordingState) {
    await chrome.action.setBadgeText({ text: state.isPaused ? '⏸' : '' })
}

// Broadcast recording state to all option pages
async function broadcastRecordingState() {
    const { isRecording, isPaused, totalPausedMs, pausedAtMs, screenSize, startAtMs, stopAtMs } =
        await getRecordingState()
    // When paused, include current pause duration in totalPausedMs
    const effectivePausedMs = (totalPausedMs ?? 0) + (isPaused && pausedAtMs != null ? Date.now() - pausedAtMs : 0)
    const msg: RecordingStateMessage = {
        type: 'recording-state',
        data: {
            isRecording,
            isPaused,
            totalPausedMs: effectivePausedMs,
            screenSize,
            startAtMs,
            stopAtMs,
        },
    }
    try {
        await chrome.runtime.sendMessage(msg)
    } catch (e) {
        console.error('Failed to send recording state:', e)
    }
}

const messageHandlerDeps: ServiceWorkerDeps = {
    getRecordingState,
    setRecordingState,
    getConfiguration,
    getRemoteConfiguration,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    broadcastRecordingState,
    updateActionTitle,
    resizeWindow,
    storageSyncSet: (key, value) => storage.set(key, value),
    claimClients: () => self.clients.claim(),
}

chrome.runtime.onMessage.addListener(
    createMessageListener(messageHandlerDeps, async e => {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }),
)

async function resizeWindow({ width, height }: Resolution) {
    const window = await chrome.windows.getCurrent()
    if (window.id == null) return
    const updateInfo: chrome.windows.UpdateInfo = {
        width,
        height,
        state: 'normal',
    }
    await chrome.windows.update(window.id, updateInfo)
}

async function getRemoteConfiguration(): Promise<Configuration | null> {
    return (await storage.get(Configuration.key)) as Configuration | null
}

async function getConfiguration(): Promise<Configuration> {
    const defaultConfig = new Configuration()
    const remoteConfig = await getRemoteConfiguration()
    return remoteConfig == null ? defaultConfig : deepMerge(defaultConfig, remoteConfig)
}

// remote configuration change log
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync' || changes[Configuration.key] == null) return
    const { newValue } = changes[Configuration.key]
    console.log('updated:', newValue)
})

// ============================================================================
// REST API for Recording Storage
// ============================================================================

const recordingStorage = new OPFSStorage()
const recordingDB = new RecordingDB()
const API_PREFIX = '/api/'

// Fetch event listener for REST API
// Using type assertion since Service Worker global scope supports 'fetch' event
declare const self: ServiceWorkerGlobalScope
self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url)

    // Only intercept /api/* requests from the same origin
    if (url.origin === location.origin && url.pathname.startsWith(API_PREFIX)) {
        event.respondWith(
            (async () => {
                return handleApiRequest(event.request, recordingStorage, await getRecordingState(), recordingDB)
            })(),
        )
    }
})

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim())
})
