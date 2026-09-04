import { Settings } from './element/settings'
import type {
    Message,
    StartRecordingResponse,
    CheckWhisperModelResponse,
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
import { RecordingDB } from './recording_db'
import { errorToString } from './error'
import { OPFSCache } from './transcription/opfs_cache'

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

const handler = new OffscreenHandler({
    getRecordingInfo: tabSize => Settings.getRecordingInfo(tabSize),
    getConfiguration: () => Settings.getConfiguration(),
    mergeRemoteConfiguration: remote => Settings.mergeRemoteConfiguration(remote),
    session,
    checkStoragePersisted: () => navigator.storage.persisted(),
    sendEvent,
    sendException,
    flush,
    sendRuntimeMessage: msg => chrome.runtime.sendMessage(msg),
    getLocationHash: () => window.location.hash,
    setLocationHash: hash => {
        window.location.hash = hash
    },
    recordingDB,
    getVideoFile: async (path: string) => {
        const dirHandle = await navigator.storage.getDirectory()
        const fileHandle = await dirHandle.getFileHandle(path)
        return await fileHandle.getFile()
    },
    saveVttFile: async (path: string, content: string) => {
        const dirHandle = await navigator.storage.getDirectory()
        const fileHandle = await dirHandle.getFileHandle(path, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(content)
        await writable.close()
    },
    checkWhisperModel: async () => {
        const cache = new OPFSCache()
        const hasModel = await cache.hasModel()
        const sizeBytes = await cache.getTotalSize()
        return { hasModel, sizeBytes }
    },
    deleteWhisperModel: async () => {
        const cache = new OPFSCache()
        await cache.clear()
    },
})

chrome.runtime.onMessage.addListener(
    (
        message: Message,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: StartRecordingResponse | CheckWhisperModelResponse) => void,
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
