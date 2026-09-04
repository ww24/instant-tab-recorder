import type { Message, Trigger, CheckWhisperModelResponse, StartTranscriptionResponse } from './message'
import { Configuration, type Resolution } from './configuration'
import type { RecordingState } from './handler'
import { deepMerge } from './element/util'

export interface ServiceWorkerDeps {
    getRecordingState: () => Promise<RecordingState>
    setRecordingState: (state: RecordingState) => Promise<void>
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
    ensureOffscreenDocument: () => Promise<void>
    maybeCloseOffscreenDocument: () => Promise<void>
    getActiveTranscribingRecordedAt: () => number | null
    setActiveTranscribingRecordedAt: (recordedAt: number | null) => Promise<void>
    setDownloadingModel: (downloading: boolean) => void
    sendRuntimeMessage: (msg: Message) => Promise<unknown>
    checkWhisperModel: () => Promise<CheckWhisperModelResponse>
    deleteWhisperModel: () => Promise<void>
}

export type HandleMessageResult = {
    response: Promise<Configuration | CheckWhisperModelResponse | StartTranscriptionResponse | void>
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
            return { response: handleStartTranscription(message, deps), fireAndForget: false }
        case 'transcription-complete':
        case 'transcription-error':
            return { response: handleTranscriptionEnded(deps), fireAndForget: true }
        case 'download-whisper-model':
            return { response: handleDownloadWhisperModel(message, deps), fireAndForget: true }
        case 'whisper-model-download-complete':
            return { response: handleModelDownloadComplete(deps), fireAndForget: true }
        case 'check-whisper-model':
            return { response: deps.checkWhisperModel(), fireAndForget: false }
        case 'delete-whisper-model':
            return { response: deps.deleteWhisperModel(), fireAndForget: true }
    }
    return null
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
    const timerState = await deps.getRecordingState()
    if (timerState.isRecording) {
        const updatedTimerState = { ...timerState, stopAtMs: message.stopAtMs ?? undefined }
        await deps.setRecordingState(updatedTimerState)
        await deps.broadcastRecordingState()
        await deps.updateActionTitle(updatedTimerState)
    }
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

async function handleStartTranscription(
    message: Extract<Message, { type: 'start-transcription' }>,
    deps: ServiceWorkerDeps,
): Promise<StartTranscriptionResponse> {
    const active = deps.getActiveTranscribingRecordedAt()
    if (active != null) {
        return { ok: false, error: 'Another transcription is already in progress.' }
    }
    await deps.setActiveTranscribingRecordedAt(message.recordedAt)
    await deps.ensureOffscreenDocument()
    // Broadcast started message to all option pages so buttons are disabled synchronously
    await deps.sendRuntimeMessage({
        type: 'transcription-started',
        recordedAt: message.recordedAt,
    })
    await deps.sendRuntimeMessage({ ...message, target: 'offscreen' })
    return { ok: true }
}

async function handleTranscriptionEnded(deps: ServiceWorkerDeps): Promise<void> {
    await deps.setActiveTranscribingRecordedAt(null)
    await deps.maybeCloseOffscreenDocument()
}

async function handleDownloadWhisperModel(
    message: Extract<Message, { type: 'download-whisper-model' }>,
    deps: ServiceWorkerDeps,
): Promise<void> {
    deps.setDownloadingModel(true)
    await deps.ensureOffscreenDocument()
    await deps.sendRuntimeMessage({ ...message, target: 'offscreen' })
}

async function handleModelDownloadComplete(deps: ServiceWorkerDeps): Promise<void> {
    deps.setDownloadingModel(false)
    await deps.maybeCloseOffscreenDocument()
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
    sendResponse: (response?: Configuration | CheckWhisperModelResponse | StartTranscriptionResponse) => void,
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
            .then(res => {
                if (res != null) sendResponse(res)
                else sendResponse()
            })
            .catch(e => {
                onError(e)
                sendResponse()
            })
        return true // asynchronous flag
    }
}
