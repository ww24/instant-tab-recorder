import type {
    Message,
    MuteMicrophoneMessage,
    MuteMicrophoneResponse,
    PauseRecordingMessage,
    ResumeRecordingMessage,
    StartRecordingMessage,
    StartRecordingResponse,
    Trigger,
    UnmuteMicrophoneMessage,
} from './message'
import { Configuration, type Resolution } from './configuration'
import type { RecordingState } from './handler'
import { deepMerge } from './element/util'

export type RecordingStateUpdater = (state: RecordingState) => RecordingState | null | Promise<RecordingState | null>

export interface ServiceWorkerDeps {
    getRecordingState: () => Promise<RecordingState>
    setRecordingState: (state: RecordingState) => Promise<void>
    updateRecordingState: (updater: RecordingStateUpdater) => Promise<RecordingState | null>
    getConfiguration: () => Promise<Configuration>
    getRemoteConfiguration: () => Promise<Configuration | null>
    stopRecording: (trigger: Trigger, skipConfirmation?: boolean) => Promise<void>
    pauseRecording: (trigger: Trigger) => Promise<void>
    resumeRecording: (trigger: Trigger) => Promise<void>
    cancelRecording: (error: string) => Promise<void>
    broadcastRecordingState: () => Promise<void>
    updateActionTitle: (state: RecordingState) => Promise<void>
    resizeWindow: (resolution: Resolution) => Promise<void>
    storageSyncSet: (key: string, value: object) => Promise<void>
    claimClients: () => Promise<void>
    isOffscreenDocumentOpen?: () => Promise<boolean>
    ensureOffscreenDocument?: () => Promise<void>
    sendRuntimeMessage?: (msg: Message) => Promise<unknown>
}

export type HandleMessageResult = {
    response: Promise<Configuration | void>
    fireAndForget: boolean
}

export function handleMessage(message: Message, deps: ServiceWorkerDeps): HandleMessageResult | null {
    switch (message.type) {
        case 'resize-window':
            return { response: handleResizeWindow(message, deps), fireAndForget: true }
        case 'recording-tick':
            return { response: handleRecordingTick(deps), fireAndForget: true }
        case 'tab-track-ended':
            return { response: deps.stopRecording('tab-track-ended', true), fireAndForget: true }
        case 'timer-expired':
            return { response: deps.stopRecording('timer', true), fireAndForget: true }
        case 'timer-updated':
            return { response: handleTimerUpdated(message, deps), fireAndForget: true }
        case 'confirm-timer-stop':
            return { response: deps.stopRecording(message.trigger, true), fireAndForget: true }
        case 'unexpected-recording-state':
            return { response: deps.cancelRecording(message.error), fireAndForget: true }
        case 'save-config-sync':
            return { response: handleSaveConfigSync(message, deps), fireAndForget: true }
        case 'fetch-config':
            return { response: handleFetchConfig(deps), fireAndForget: false }
        case 'request-recording-state':
            return { response: handleRequestRecordingState(deps), fireAndForget: true }
        case 'claim-clients':
            return { response: deps.claimClients(), fireAndForget: false }
        case 'start-transcription':
        case 'query-transcription-status':
        case 'start-model-download':
        case 'cancel-model-download':
        case 'query-model-download-status':
        case 'start-summary':
        case 'query-summary-status':
        case 'cancel-tasks-for-path':
            return { response: handleForwardToOffscreen(message, deps), fireAndForget: true }
    }
    return null
}

async function handleForwardToOffscreen(message: Message, deps: ServiceWorkerDeps): Promise<void> {
    if (!deps.ensureOffscreenDocument || !deps.isOffscreenDocumentOpen || !deps.sendRuntimeMessage) return
    const isOpen = await deps.isOffscreenDocumentOpen()

    switch (message.type) {
        case 'start-transcription':
        case 'start-model-download':
        case 'start-summary': {
            if (!isOpen) {
                await deps.ensureOffscreenDocument()
                await deps.sendRuntimeMessage(message)
            }
            break
        }
        case 'query-transcription-status': {
            if (!isOpen) {
                await deps.sendRuntimeMessage({
                    type: 'transcription-status-response',
                    path: message.path,
                    isTranscribing: false,
                })
            }
            break
        }
        case 'query-summary-status': {
            if (!isOpen) {
                await deps.sendRuntimeMessage({
                    type: 'summary-status-response',
                    path: message.path,
                    isSummarizing: false,
                })
            }
            break
        }
        case 'query-model-download-status': {
            if (!isOpen) {
                await deps.sendRuntimeMessage({
                    type: 'model-download-status-response',
                    modelType: message.modelType,
                    isDownloading: false,
                    progress: null,
                })
            }
            break
        }
        case 'cancel-model-download': {
            // If offscreen document is not open, no download is active
            break
        }
        case 'cancel-tasks-for-path': {
            // If offscreen document is not open, no tasks are active
            break
        }
    }
}

async function handleResizeWindow(
    message: Extract<Message, { type: 'resize-window' }>,
    deps: ServiceWorkerDeps,
): Promise<void> {
    if (typeof message.data !== 'object' || message.data == null) return
    await deps.resizeWindow(message.data)
}

async function handleRecordingTick(deps: ServiceWorkerDeps): Promise<void> {
    const state = await deps.getRecordingState()
    await deps.updateActionTitle(state)
}

async function handleTimerUpdated(
    message: Extract<Message, { type: 'timer-updated' }>,
    deps: ServiceWorkerDeps,
): Promise<void> {
    const updatedTimerState = await deps.updateRecordingState(timerState =>
        timerState.isRecording ? { ...timerState, stopAtMs: message.stopAtMs ?? undefined } : null,
    )
    if (updatedTimerState) {
        await deps.broadcastRecordingState()
        await deps.updateActionTitle(updatedTimerState)
    }
}

export const DEFAULT_IPC_TIMEOUT_MS = 5_000

function sendWithTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_IPC_TIMEOUT_MS): Promise<T> {
    let timerId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
            reject(new Error(`Offscreen IPC timed out after ${timeoutMs}ms`))
        }, timeoutMs)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timerId != null) clearTimeout(timerId)
    })
}

export interface RecordingStateManager {
    getRecordingState: () => Promise<RecordingState>
    setRecordingState: (state: RecordingState) => Promise<void>
    updateRecordingState: (updater: RecordingStateUpdater) => Promise<RecordingState | null>
    setStarting: (starting: boolean) => void
}

/**
 * Creates accessors for reading, writing, and atomically updating RecordingState.
 * - `getRecordingState` does not enter the mutation queue so read-only callers (ticks, UI, fetch) never block.
 * - While `isStarting` is true, reads return `{ isRecording: false }` and updates return `null` so controls
 *   invoked during startup are ignored rather than reading stale state from a previous session.
 * - `setRecordingState` and `updateRecordingState` are serialized via a Promise queue to prevent lost updates.
 */
export function createRecordingStateManager(
    readState: () => Promise<RecordingState>,
    writeState: (state: RecordingState) => Promise<void>,
): RecordingStateManager {
    let queue: Promise<void> = Promise.resolve()
    let isStarting = false

    function enqueue<T>(op: () => Promise<T>): Promise<T> {
        const next = queue.then(op, op)
        queue = next.then(
            () => undefined,
            () => undefined,
        )
        return next
    }

    return {
        getRecordingState: async () => {
            if (isStarting) return { isRecording: false }
            return readState()
        },
        setRecordingState: (state: RecordingState) =>
            enqueue(async () => {
                try {
                    await writeState(state)
                } finally {
                    isStarting = false
                }
            }),
        updateRecordingState: (updater: RecordingStateUpdater) =>
            enqueue(async () => {
                if (isStarting) return null
                const state = await readState()
                const nextState = await updater(state)
                if (nextState == null) return null
                await writeState(nextState)
                return nextState
            }),
        setStarting: (starting: boolean) => {
            isStarting = starting
        },
    }
}

/**
 * Sends `start-recording` outside the state mutation queue while marking the manager as `starting`,
 * then persists the initial state inside the queue once the offscreen document responds.
 */
export async function startRecordingSession(
    msg: StartRecordingMessage,
    screenSize: Resolution,
    stateManager: Pick<RecordingStateManager, 'setRecordingState' | 'setStarting'>,
    sendRuntimeMessage: (msg: StartRecordingMessage) => Promise<StartRecordingResponse | undefined>,
    onStateUpdated: () => Promise<void>,
): Promise<void> {
    stateManager.setStarting(true)
    try {
        const response = await sendRuntimeMessage(msg)
        if (response == null) {
            throw new Error('unexpected start recording response')
        }
        await stateManager.setRecordingState({
            isRecording: true,
            screenSize,
            startAtMs: response.startAtMs,
            recordingMode: response.recordingMode,
            micEnabled: response.micEnabled,
            stopAtMs: response.stopAtMs,
        })
    } finally {
        stateManager.setStarting(false)
    }
    await onStateUpdated()
}

export function createPauseUpdater(
    trigger: Trigger,
    sendRuntimeMessage: (msg: PauseRecordingMessage) => Promise<unknown>,
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
): RecordingStateUpdater {
    return async state => {
        if (!state.isRecording || state.isPaused) return null
        const msg: PauseRecordingMessage = { type: 'pause-recording', trigger }
        await sendWithTimeout(sendRuntimeMessage(msg), timeoutMs)
        return { ...state, isPaused: true, pausedAtMs: Date.now() }
    }
}

export function createResumeUpdater(
    trigger: Trigger,
    sendRuntimeMessage: (msg: ResumeRecordingMessage) => Promise<unknown>,
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
): RecordingStateUpdater {
    return async state => {
        if (!state.isRecording || !state.isPaused) return null
        const msg: ResumeRecordingMessage = { type: 'resume-recording', trigger }
        await sendWithTimeout(sendRuntimeMessage(msg), timeoutMs)
        const pausedDuration = state.pausedAtMs != null ? Date.now() - state.pausedAtMs : 0
        const totalPausedMs = (state.totalPausedMs ?? 0) + pausedDuration
        return { ...state, isPaused: false, pausedAtMs: undefined, totalPausedMs }
    }
}

export async function pauseRecordingSession(
    trigger: Trigger,
    stateManager: Pick<RecordingStateManager, 'updateRecordingState'>,
    sendRuntimeMessage: (msg: PauseRecordingMessage) => Promise<unknown>,
    onStateUpdated: () => Promise<void>,
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
): Promise<void> {
    const updated = await stateManager.updateRecordingState(createPauseUpdater(trigger, sendRuntimeMessage, timeoutMs))
    if (updated == null) return
    await onStateUpdated()
}

export async function resumeRecordingSession(
    trigger: Trigger,
    stateManager: Pick<RecordingStateManager, 'updateRecordingState'>,
    sendRuntimeMessage: (msg: ResumeRecordingMessage) => Promise<unknown>,
    onStateUpdated: () => Promise<void>,
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
): Promise<void> {
    const updated = await stateManager.updateRecordingState(createResumeUpdater(trigger, sendRuntimeMessage, timeoutMs))
    if (updated == null) return
    await onStateUpdated()
}

export async function togglePauseRecordingSession(
    trigger: Trigger,
    stateManager: Pick<RecordingStateManager, 'updateRecordingState'>,
    sendRuntimeMessage: (msg: PauseRecordingMessage | ResumeRecordingMessage) => Promise<unknown>,
    onStateUpdated: () => Promise<void>,
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
): Promise<void> {
    const pauseUpdater = createPauseUpdater(trigger, sendRuntimeMessage, timeoutMs)
    const resumeUpdater = createResumeUpdater(trigger, sendRuntimeMessage, timeoutMs)
    const updated = await stateManager.updateRecordingState(state =>
        state.isPaused ? resumeUpdater(state) : pauseUpdater(state),
    )
    if (updated == null) return
    await onStateUpdated()
}

/**
 * Serializes the complete read -> send message -> persist state operation for toggling microphone mute.
 * Uses the `isMicMuted` value returned by the offscreen document as the source of truth.
 */
export async function toggleMicrophoneMute(
    trigger: Trigger,
    stateManager: Pick<RecordingStateManager, 'updateRecordingState'>,
    sendRuntimeMessage: (
        msg: MuteMicrophoneMessage | UnmuteMicrophoneMessage,
    ) => Promise<MuteMicrophoneResponse | undefined>,
    onStateUpdated: () => Promise<void>,
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
): Promise<void> {
    const updated = await stateManager.updateRecordingState(async state => {
        if (!state.isRecording || !state.micEnabled) return null
        const nextMuted = !state.isMicMuted
        const msg: MuteMicrophoneMessage | UnmuteMicrophoneMessage = {
            type: nextMuted ? 'mute-microphone' : 'unmute-microphone',
            trigger,
        }
        const response = await sendWithTimeout(sendRuntimeMessage(msg), timeoutMs)
        if (response == null || typeof response.isMicMuted !== 'boolean') return null
        return { ...state, isMicMuted: response.isMicMuted }
    })
    if (updated == null) return
    await onStateUpdated()
}

async function handleSaveConfigSync(
    message: Extract<Message, { type: 'save-config-sync' }>,
    deps: ServiceWorkerDeps,
): Promise<void> {
    await deps.storageSyncSet(Configuration.key, message.data)
}

async function handleFetchConfig(deps: ServiceWorkerDeps): Promise<Configuration | void> {
    const defaultConfig = new Configuration()
    const remoteConfig = await deps.getRemoteConfiguration()
    if (remoteConfig == null) return
    const config = deepMerge(defaultConfig, remoteConfig)
    console.debug('fetch:', config)
    return config
}

async function handleRequestRecordingState(deps: ServiceWorkerDeps): Promise<void> {
    await deps.broadcastRecordingState()
}

/**
 * Creates the chrome.runtime.onMessage listener callback.
 * Extracted for testability.
 */
export function createMessageListener(
    deps: ServiceWorkerDeps,
    onError: (e: unknown) => void,
): (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: Configuration) => void,
) => boolean | undefined {
    return (message, _sender, sendResponse) => {
        const result = handleMessage(message, deps)
        if (result == null) return

        if (result.fireAndForget) {
            result.response.catch(onError)
            // NOTE: Must not return true or a truthy value to avoid blocking
            // sendMessage callers waiting for responses from other contexts.
            return
        }

        result.response
            .then(config => {
                if (config != null) sendResponse(config)
                else sendResponse()
            })
            .catch(e => {
                onError(e)
                sendResponse()
            })
        return true // asynchronous flag
    }
}
