import { Settings } from './element/settings'
import type {
    Message,
    StartRecordingResponse,
    TabTrackEndedMessage,
    PreviewFrameMessage,
    UnexpectedRecordingStateMessage,
    RecordingTickMessage,
} from './message'
import { flush, sendEvent, sendException } from './sentry'
import { Preview } from './preview'
import { Crop } from './crop'
import { createRecordingSession } from './recorder'
import { OffscreenHandler } from './offscreen_handler'
import { TranscriptionSession } from './transcription/session'
import { TranscriptionModelDownloader } from './transcription/model_downloader'
import { SummarySession } from './summary/session'
import { SummaryModelDownloader } from './summary/model_downloader'
import { RecordingDB, parseRecordedAt } from './recording_db'
import { errorToString } from './error'

const preview = new Preview(async ({ image, width, height }) => {
    const msg: PreviewFrameMessage = {
        type: 'preview-frame',
        recordingSize: { width, height },
        image: new Uint8Array(await image.arrayBuffer()).toBase64(),
    }
    await chrome.runtime.sendMessage(msg)
})
const crop = new Crop()

const session = createRecordingSession(preview, crop, {
    onTabTrackEnded: async () => {
        try {
            const msg: TabTrackEndedMessage = { type: 'tab-track-ended' }
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            console.error(e)
            sendException(e, { exceptionSource: 'tabTrack.ended' })
        }
    },
    onSourceError: async (e: Error) => {
        sendException(e, { exceptionSource: 'offscreen.startRecording' })
        const msg: UnexpectedRecordingStateMessage = { type: 'unexpected-recording-state', error: errorToString(e) }
        try {
            await chrome.runtime.sendMessage(msg)
        } catch (sendErr) {
            console.error(sendErr)
            sendException(sendErr, { exceptionSource: 'offscreen.startRecording.sendMessage' })
        }
    },
    onTick: async () => {
        const tickMsg: RecordingTickMessage = { type: 'recording-tick' }
        await chrome.runtime.sendMessage(tickMsg)
    },
})

const recordingDB = new RecordingDB()

const getVideoFile = async (path: string) => {
    const dirHandle = await navigator.storage.getDirectory()
    const fileHandle = await dirHandle.getFileHandle(path)
    return await fileHandle.getFile()
}

const transcriptionSession = new TranscriptionSession({
    getVideoFile,
    saveTranscription: async (path, result) => {
        const recordedAt = parseRecordedAt(path)
        if (recordedAt == null) throw new Error(`Invalid recording path: ${path}`)
        const record = await recordingDB.get(recordedAt)
        if (!record) throw new Error(`Recording record not found for: ${path}`)
        record.transcription = result
        await recordingDB.put(record)
    },
    sendEvent,
    broadcastMessage: msg => chrome.runtime.sendMessage(msg),
    createWorker: () => {
        const workerUrl = chrome.runtime.getURL('dist/transcription_worker.js')
        return new Worker(workerUrl, { type: 'module' })
    },
    getLanguage: async () => {
        const config = Settings.getConfiguration()
        return config.transcription?.language || 'english'
    },
})

const modelDownloader = new TranscriptionModelDownloader()

const summarySession = new SummarySession({
    getTranscription: async path => {
        const recordedAt = parseRecordedAt(path)
        if (recordedAt == null) throw new Error(`Invalid recording path: ${path}`)
        const record = await recordingDB.get(recordedAt)
        return record?.transcription ?? null
    },
    saveSummary: async (path, result) => {
        const recordedAt = parseRecordedAt(path)
        if (recordedAt == null) throw new Error(`Invalid recording path: ${path}`)
        const record = await recordingDB.get(recordedAt)
        if (!record) throw new Error(`Recording record not found for: ${path}`)
        record.summary = result
        await recordingDB.put(record)
    },
    broadcastMessage: msg => chrome.runtime.sendMessage(msg),
    createWorker: () => {
        const workerUrl = chrome.runtime.getURL('dist/summary_worker.js')
        return new Worker(workerUrl, { type: 'module' })
    },
    getPrompt: () => Settings.getConfiguration().summary?.prompt,
})

const summaryModelDownloader = new SummaryModelDownloader()

const handler = new OffscreenHandler({
    getRecordingInfo: tabSize => Settings.getRecordingInfo(tabSize),
    getConfiguration: () => Settings.getConfiguration(),
    mergeRemoteConfiguration: remote => Settings.mergeRemoteConfiguration(remote),
    session,
    sendEvent,
    sendException,
    flush,
    sendRuntimeMessage: msg => chrome.runtime.sendMessage(msg),
    getLocationHash: () => window.location.hash,
    setLocationHash: hash => {
        window.location.hash = hash
    },
    recordingDB,
    getVideoFile,
    transcriptionSession,
    transcriptionModelDownloader: modelDownloader,
    summarySession,
    summaryModelDownloader,
    closeDocument: () => {
        setTimeout(() => {
            window.close()
        }, 0)
    },
})

chrome.runtime.onMessage.addListener(
    (
        message: Message,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: StartRecordingResponse) => void,
    ) => {
        const resultPromise = handler.handleMessage(message)
        if (resultPromise == null) return

        resultPromise
            .then(result => {
                if (result != null) sendResponse(result)
                else sendResponse()
            })
            .catch(e => {
                console.error(e)
                sendException(e, {
                    exceptionSource: 'offscreen.onMessage',
                    additionalMetadata: { messageType: message.type },
                })
                sendResponse(undefined)
            })
        return true // asynchronous flag
    },
)
