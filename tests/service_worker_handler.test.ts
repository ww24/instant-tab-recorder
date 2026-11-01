vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import {
    handleMessage,
    createMessageListener,
    createRecordingStateManager,
    pauseRecordingSession,
    resumeRecordingSession,
    startRecordingSession,
    toggleMicrophoneMute,
    togglePauseRecordingSession,
    type ServiceWorkerDeps,
} from '../src/service_worker_handler'
import type { Message } from '../src/message'
import type { RecordingState } from '../src/handler'
import type { Configuration } from '../src/configuration'

// ---------- helpers ----------

function createMockDeps(overrides: Partial<ServiceWorkerDeps> = {}): ServiceWorkerDeps {
    const getRecordingState = overrides.getRecordingState ?? vi.fn().mockResolvedValue({ isRecording: false })
    const setRecordingState = overrides.setRecordingState ?? vi.fn().mockResolvedValue(undefined)
    return {
        getRecordingState,
        setRecordingState,
        updateRecordingState: vi.fn(async updater => {
            const state = await getRecordingState()
            const nextState = await updater(state)
            if (nextState != null) {
                await setRecordingState(nextState)
            }
            return nextState
        }),
        getConfiguration: vi.fn().mockResolvedValue({} as Configuration),
        getRemoteConfiguration: vi.fn().mockResolvedValue(null),
        stopRecording: vi.fn().mockResolvedValue(undefined),
        pauseRecording: vi.fn().mockResolvedValue(undefined),
        resumeRecording: vi.fn().mockResolvedValue(undefined),
        cancelRecording: vi.fn().mockResolvedValue(undefined),
        broadcastRecordingState: vi.fn().mockResolvedValue(undefined),
        updateActionTitle: vi.fn().mockResolvedValue(undefined),
        resizeWindow: vi.fn().mockResolvedValue(undefined),
        storageSyncSet: vi.fn().mockResolvedValue(undefined),
        claimClients: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    }
}

// ---------- confirm-timer-stop ----------

describe('confirm-timer-stop', () => {
    it('passes trigger to stopRecording with skipConfirmation=true', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'confirm-timer-stop', trigger: 'keyboard-shortcut' }, deps)
        expect(result!.fireAndForget).toBe(true)
        await result!.response
        expect(deps.stopRecording).toHaveBeenCalledWith('keyboard-shortcut', true)
    })

    it('preserves action-icon trigger', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'confirm-timer-stop', trigger: 'action-icon' }, deps)
        await result!.response
        expect(deps.stopRecording).toHaveBeenCalledWith('action-icon', true)
    })

    it('preserves context-menu trigger', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'confirm-timer-stop', trigger: 'context-menu' }, deps)
        await result!.response
        expect(deps.stopRecording).toHaveBeenCalledWith('context-menu', true)
    })
})

// ---------- timer-expired ----------

describe('timer-expired', () => {
    it('calls stopRecording with timer trigger and skipConfirmation=true', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'timer-expired' }, deps)
        expect(result!.fireAndForget).toBe(true)
        await result!.response
        expect(deps.stopRecording).toHaveBeenCalledWith('timer', true)
    })
})

// ---------- timer-updated ----------

describe('timer-updated', () => {
    it('updates recording state with stopAtMs when recording', async () => {
        const state: RecordingState = { isRecording: true, startAtMs: 1000 }
        const deps = createMockDeps({
            getRecordingState: vi.fn().mockResolvedValue(state),
        })
        const result = handleMessage({ type: 'timer-updated', stopAtMs: 61000 }, deps)
        await result!.response
        expect(deps.setRecordingState).toHaveBeenCalledWith({ ...state, stopAtMs: 61000 })
        expect(deps.broadcastRecordingState).toHaveBeenCalled()
        expect(deps.updateActionTitle).toHaveBeenCalled()
    })

    it('clears stopAtMs when stopAtMs is null', async () => {
        const state: RecordingState = { isRecording: true, startAtMs: 1000, stopAtMs: 61000 }
        const deps = createMockDeps({
            getRecordingState: vi.fn().mockResolvedValue(state),
        })
        const result = handleMessage({ type: 'timer-updated', stopAtMs: null }, deps)
        await result!.response
        expect(deps.setRecordingState).toHaveBeenCalledWith({ ...state, stopAtMs: undefined })
    })

    it('does nothing when not recording', async () => {
        const deps = createMockDeps({
            getRecordingState: vi.fn().mockResolvedValue({ isRecording: false }),
        })
        const result = handleMessage({ type: 'timer-updated', stopAtMs: 61000 }, deps)
        await result!.response
        expect(deps.setRecordingState).not.toHaveBeenCalled()
        expect(deps.broadcastRecordingState).not.toHaveBeenCalled()
    })
})

// ---------- tab-track-ended ----------

describe('tab-track-ended', () => {
    it('calls stopRecording with tab-track-ended trigger and skipConfirmation=true (fire-and-forget)', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'tab-track-ended' }, deps)
        expect(result!.fireAndForget).toBe(true)
        await result!.response
        expect(deps.stopRecording).toHaveBeenCalledWith('tab-track-ended', true)
    })
})

// ---------- unexpected-recording-state ----------

describe('unexpected-recording-state', () => {
    it('calls cancelRecording with error (fire-and-forget)', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'unexpected-recording-state', error: 'test error' }, deps)
        expect(result!.fireAndForget).toBe(true)
        await result!.response
        expect(deps.cancelRecording).toHaveBeenCalledWith('test error')
    })
})

// ---------- recording-tick ----------

describe('recording-tick', () => {
    it('updates action title with current state', async () => {
        const state: RecordingState = { isRecording: true, startAtMs: 1000 }
        const deps = createMockDeps({
            getRecordingState: vi.fn().mockResolvedValue(state),
        })
        const result = handleMessage({ type: 'recording-tick' }, deps)
        await result!.response
        expect(deps.updateActionTitle).toHaveBeenCalledWith(state)
    })
})

// ---------- resize-window ----------

describe('resize-window', () => {
    it('calls resizeWindow with data', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'resize-window', data: { width: 1280, height: 720 } }, deps)
        await result!.response
        expect(deps.resizeWindow).toHaveBeenCalledWith({ width: 1280, height: 720 })
    })

    it('ignores invalid data (null)', async () => {
        const deps = createMockDeps()
        const result = handleMessage(
            { type: 'resize-window', data: null as unknown as { width: number; height: number } },
            deps,
        )
        await result!.response
        expect(deps.resizeWindow).not.toHaveBeenCalled()
    })
})

// ---------- save-config-sync ----------

describe('save-config-sync', () => {
    it('saves config to sync storage', async () => {
        const deps = createMockDeps()
        const syncData = { key: 'value' } as unknown as Configuration
        const result = handleMessage({ type: 'save-config-sync', data: syncData } as Message, deps)
        await result!.response
        expect(deps.storageSyncSet).toHaveBeenCalledWith('settings', syncData)
    })
})

// ---------- fetch-config ----------

describe('fetch-config', () => {
    it('returns merged config when remote exists', async () => {
        const remoteConfig = { userId: 'test-user' } as Configuration
        const deps = createMockDeps({
            getRemoteConfiguration: vi.fn().mockResolvedValue(remoteConfig),
        })
        const result = handleMessage({ type: 'fetch-config' }, deps)
        const config = await result!.response
        expect(config).toBeDefined()
        expect(config?.userId).toBe('test-user')
    })

    it('returns undefined when no remote config', async () => {
        const deps = createMockDeps({
            getRemoteConfiguration: vi.fn().mockResolvedValue(null),
        })
        const result = handleMessage({ type: 'fetch-config' }, deps)
        const config = await result!.response
        expect(config).toBeUndefined()
    })
})

// ---------- request-recording-state ----------

describe('request-recording-state', () => {
    it('broadcasts recording state', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'request-recording-state' }, deps)
        await result!.response
        expect(deps.broadcastRecordingState).toHaveBeenCalled()
    })
})

// ---------- claim-clients ----------

describe('claim-clients', () => {
    it('calls claimClients and returns fireAndForget=false', async () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'claim-clients' }, deps)
        expect(result).not.toBeNull()
        expect(result!.fireAndForget).toBe(false)
        await result!.response
        expect(deps.claimClients).toHaveBeenCalled()
    })
})

// ---------- unknown message types ----------

describe('unknown message type', () => {
    it('returns null for unhandled message types', () => {
        const deps = createMockDeps()
        const result = handleMessage({ type: 'start-recording' } as unknown as Message, deps)
        expect(result).toBeNull()
    })
})

// ---------- createMessageListener ----------

describe('createMessageListener', () => {
    const dummySender = {} as chrome.runtime.MessageSender

    it('returns undefined for unhandled messages (does not block sender)', () => {
        const deps = createMockDeps()
        const onError = vi.fn()
        const listener = createMessageListener(deps, onError)

        const sendResponse = vi.fn()
        const ret = listener({ type: 'start-recording' } as unknown as Message, dummySender, sendResponse)

        expect(ret).toBeUndefined()
        expect(sendResponse).not.toHaveBeenCalled()
    })

    it('returns undefined for fireAndForget messages (does not block sender)', () => {
        const deps = createMockDeps()
        const onError = vi.fn()
        const listener = createMessageListener(deps, onError)

        const sendResponse = vi.fn()
        const ret = listener({ type: 'recording-tick' } as Message, dummySender, sendResponse)

        expect(ret).toBeUndefined()
        expect(sendResponse).not.toHaveBeenCalled()
    })

    it('returns true for response messages (keeps channel open)', () => {
        const deps = createMockDeps()
        const onError = vi.fn()
        const listener = createMessageListener(deps, onError)

        const sendResponse = vi.fn()
        const ret = listener({ type: 'fetch-config' } as Message, dummySender, sendResponse)

        expect(ret).toBe(true)
    })

    it('calls sendResponse with config when response resolves', async () => {
        const remoteConfig = { userId: 'test' } as Configuration
        const deps = createMockDeps({
            getRemoteConfiguration: vi.fn().mockResolvedValue(remoteConfig),
        })
        const onError = vi.fn()
        const listener = createMessageListener(deps, onError)

        const sendResponse = vi.fn()
        listener({ type: 'fetch-config' } as Message, dummySender, sendResponse)

        await vi.waitFor(() => {
            expect(sendResponse).toHaveBeenCalledTimes(1)
        })
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ userId: 'test' }))
        expect(onError).not.toHaveBeenCalled()
    })

    it('calls sendResponse once and onError when response rejects', async () => {
        const error = new Error('fetch failed')
        const deps = createMockDeps({
            getRemoteConfiguration: vi.fn().mockRejectedValue(error),
        })
        const onError = vi.fn()
        const listener = createMessageListener(deps, onError)

        const sendResponse = vi.fn()
        listener({ type: 'fetch-config' } as Message, dummySender, sendResponse)

        await vi.waitFor(() => {
            expect(sendResponse).toHaveBeenCalledTimes(1)
        })
        expect(sendResponse).toHaveBeenCalledWith()
        expect(onError).toHaveBeenCalledWith(error)
    })

    it('calls onError when fireAndForget rejects', async () => {
        const error = new Error('tick failed')
        const deps = createMockDeps({
            getRecordingState: vi.fn().mockRejectedValue(error),
        })
        const onError = vi.fn()
        const listener = createMessageListener(deps, onError)

        const sendResponse = vi.fn()
        listener({ type: 'recording-tick' } as Message, dummySender, sendResponse)

        await vi.waitFor(() => {
            expect(onError).toHaveBeenCalledWith(error)
        })
        expect(sendResponse).not.toHaveBeenCalled()
    })
})

describe('handleForwardToOffscreen lifecycle', () => {
    it('opens offscreen document and forwards start-transcription when not open', async () => {
        const deps = createMockDeps({
            isOffscreenDocumentOpen: vi.fn().mockResolvedValue(false),
            ensureOffscreenDocument: vi.fn().mockResolvedValue(undefined),
            sendRuntimeMessage: vi.fn().mockResolvedValue(undefined),
        })
        const msg: Message = { type: 'start-transcription', path: 'video-1000.webm' }
        const result = handleMessage(msg, deps)
        expect(result!.fireAndForget).toBe(true)
        await result!.response

        expect(deps.ensureOffscreenDocument).toHaveBeenCalledTimes(1)
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith(msg)
    })

    it('does not call ensureOffscreenDocument for start-transcription when already open', async () => {
        const deps = createMockDeps({
            isOffscreenDocumentOpen: vi.fn().mockResolvedValue(true),
            ensureOffscreenDocument: vi.fn().mockResolvedValue(undefined),
            sendRuntimeMessage: vi.fn().mockResolvedValue(undefined),
        })
        const msg: Message = { type: 'start-transcription', path: 'video-1000.webm' }
        const result = handleMessage(msg, deps)
        await result!.response

        expect(deps.ensureOffscreenDocument).not.toHaveBeenCalled()
        expect(deps.sendRuntimeMessage).not.toHaveBeenCalled()
    })

    it('responds directly to query-transcription-status when offscreen document is not open', async () => {
        const deps = createMockDeps({
            isOffscreenDocumentOpen: vi.fn().mockResolvedValue(false),
            ensureOffscreenDocument: vi.fn().mockResolvedValue(undefined),
            sendRuntimeMessage: vi.fn().mockResolvedValue(undefined),
        })
        const msg: Message = { type: 'query-transcription-status', path: 'video-1000.webm' }
        const result = handleMessage(msg, deps)
        await result!.response

        expect(deps.ensureOffscreenDocument).not.toHaveBeenCalled()
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith({
            type: 'transcription-status-response',
            path: 'video-1000.webm',
            isTranscribing: false,
        })
    })

    it('responds directly to query-model-download-status when offscreen document is not open', async () => {
        const deps = createMockDeps({
            isOffscreenDocumentOpen: vi.fn().mockResolvedValue(false),
            ensureOffscreenDocument: vi.fn().mockResolvedValue(undefined),
            sendRuntimeMessage: vi.fn().mockResolvedValue(undefined),
        })
        const msg: Message = { type: 'query-model-download-status', modelType: 'transcription' }
        const result = handleMessage(msg, deps)
        await result!.response

        expect(deps.ensureOffscreenDocument).not.toHaveBeenCalled()
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith({
            type: 'model-download-status-response',
            modelType: 'transcription',
            isDownloading: false,
            progress: null,
        })
    })

    it('does not open offscreen document for cancel-model-download when not open', async () => {
        const deps = createMockDeps({
            isOffscreenDocumentOpen: vi.fn().mockResolvedValue(false),
            ensureOffscreenDocument: vi.fn().mockResolvedValue(undefined),
            sendRuntimeMessage: vi.fn().mockResolvedValue(undefined),
        })
        const msg: Message = { type: 'cancel-model-download', modelType: 'transcription' }
        const result = handleMessage(msg, deps)
        await result!.response

        expect(deps.ensureOffscreenDocument).not.toHaveBeenCalled()
    })
})

describe('createRecordingStateManager', () => {
    it('serializes overlapping updateRecordingState calls so changes do not overwrite each other', async () => {
        let storedState: RecordingState = {
            isRecording: true,
            micEnabled: true,
            isMicMuted: false,
            isPaused: false,
        }

        const readState = vi.fn(async () => {
            // Simulate async storage read latency
            await new Promise(resolve => setTimeout(resolve, 10))
            return { ...storedState }
        })
        const writeState = vi.fn(async (nextState: RecordingState) => {
            await new Promise(resolve => setTimeout(resolve, 10))
            storedState = { ...nextState }
        })

        const manager = createRecordingStateManager(readState, writeState)

        // Fire mute, pause, and timer update concurrently
        const [muteResult, pauseResult, timerResult] = await Promise.all([
            manager.updateRecordingState(state => (state.isRecording ? { ...state, isMicMuted: true } : null)),
            manager.updateRecordingState(state =>
                state.isRecording ? { ...state, isPaused: true, pausedAtMs: 5000 } : null,
            ),
            manager.updateRecordingState(state => (state.isRecording ? { ...state, stopAtMs: 60000 } : null)),
        ])

        expect(muteResult).toEqual({
            isRecording: true,
            micEnabled: true,
            isMicMuted: true,
            isPaused: false,
        })
        expect(pauseResult).toEqual({
            isRecording: true,
            micEnabled: true,
            isMicMuted: true,
            isPaused: true,
            pausedAtMs: 5000,
        })
        expect(timerResult).toEqual({
            isRecording: true,
            micEnabled: true,
            isMicMuted: true,
            isPaused: true,
            pausedAtMs: 5000,
            stopAtMs: 60000,
        })

        const finalState = await manager.getRecordingState()
        expect(finalState).toEqual({
            isRecording: true,
            micEnabled: true,
            isMicMuted: true,
            isPaused: true,
            pausedAtMs: 5000,
            stopAtMs: 60000,
        })
    })

    it('skips writeState when updater returns null', async () => {
        const storedState: RecordingState = { isRecording: false }
        const readState = vi.fn().mockResolvedValue(storedState)
        const writeState = vi.fn().mockResolvedValue(undefined)

        const manager = createRecordingStateManager(readState, writeState)
        const result = await manager.updateRecordingState(state =>
            state.isRecording ? { ...state, isMicMuted: true } : null,
        )

        expect(result).toBeNull()
        expect(writeState).not.toHaveBeenCalled()
    })

    it('does not block getRecordingState while updateRecordingState is awaiting IPC', async () => {
        const storedState: RecordingState = { isRecording: true, startAtMs: 1000 }
        const readState = vi.fn().mockResolvedValue(storedState)
        const writeState = vi.fn().mockResolvedValue(undefined)
        const manager = createRecordingStateManager(readState, writeState)

        let releaseUpdate!: () => void
        const updatePromise = manager.updateRecordingState(async state => {
            await new Promise<void>(resolve => {
                releaseUpdate = resolve
            })
            return { ...state, isPaused: true }
        })

        // getRecordingState should resolve immediately even while updateRecordingState is in flight
        const readResult = await manager.getRecordingState()
        expect(readResult).toEqual(storedState)

        releaseUpdate()
        await updatePromise
    })
})

describe('toggleMicrophoneMute', () => {
    it('serializes overlapping toggle invocations and persists isMicMuted from offscreen response', async () => {
        let storedState: RecordingState = {
            isRecording: true,
            micEnabled: true,
            isMicMuted: false,
        }

        const readState = vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
            return { ...storedState }
        })
        const writeState = vi.fn(async (nextState: RecordingState) => {
            await new Promise(resolve => setTimeout(resolve, 10))
            storedState = { ...nextState }
        })

        const manager = createRecordingStateManager(readState, writeState)
        const sentMessages: Message[] = []
        let offscreenMicMuted = false
        const sendRuntimeMessage = vi.fn(async (msg: Message) => {
            await new Promise(resolve => setTimeout(resolve, 15))
            sentMessages.push(msg)
            offscreenMicMuted = msg.type === 'mute-microphone'
            return { isMicMuted: offscreenMicMuted }
        })
        const onStateUpdated = vi.fn().mockResolvedValue(undefined)

        // Invoke two toggles concurrently (e.g. rapid shortcut presses or shortcut + context menu)
        await Promise.all([
            toggleMicrophoneMute('keyboard-shortcut', manager, sendRuntimeMessage, onStateUpdated),
            toggleMicrophoneMute('context-menu', manager, sendRuntimeMessage, onStateUpdated),
        ])

        expect(sentMessages).toEqual([
            { type: 'mute-microphone', trigger: 'keyboard-shortcut' },
            { type: 'unmute-microphone', trigger: 'context-menu' },
        ])
        expect(storedState.isMicMuted).toBe(false)
        expect(onStateUpdated).toHaveBeenCalledTimes(2)
    })

    it('does not update state when offscreen fails and returns undefined', async () => {
        let storedState: RecordingState = {
            isRecording: true,
            micEnabled: true,
            isMicMuted: false,
        }
        const writeState = vi.fn(async (nextState: RecordingState) => {
            storedState = { ...nextState }
        })
        const manager = createRecordingStateManager(
            vi.fn().mockImplementation(async () => ({ ...storedState })),
            writeState,
        )
        const sendRuntimeMessage = vi.fn().mockResolvedValue(undefined)
        const onStateUpdated = vi.fn().mockResolvedValue(undefined)

        await toggleMicrophoneMute('keyboard-shortcut', manager, sendRuntimeMessage, onStateUpdated)

        expect(sendRuntimeMessage).toHaveBeenCalledWith({
            type: 'mute-microphone',
            trigger: 'keyboard-shortcut',
        })
        expect(writeState).not.toHaveBeenCalled()
        expect(storedState.isMicMuted).toBe(false)
        expect(onStateUpdated).not.toHaveBeenCalled()
    })

    it('times out and releases queue when offscreen does not respond', async () => {
        let storedState: RecordingState = {
            isRecording: true,
            micEnabled: true,
            isMicMuted: false,
        }
        const manager = createRecordingStateManager(
            vi.fn(async () => ({ ...storedState })),
            vi.fn(async nextState => {
                storedState = { ...nextState }
            }),
        )
        const neverResolvingSend = vi.fn(() => new Promise<never>(() => {}))
        const onStateUpdated = vi.fn().mockResolvedValue(undefined)

        await expect(
            toggleMicrophoneMute('keyboard-shortcut', manager, neverResolvingSend, onStateUpdated, 20),
        ).rejects.toThrow('Offscreen IPC timed out after 20ms')

        // Subsequent operations in the queue should still succeed
        await toggleMicrophoneMute(
            'keyboard-shortcut',
            manager,
            vi.fn().mockResolvedValue({ isMicMuted: true }),
            onStateUpdated,
        )
        expect(storedState.isMicMuted).toBe(true)
    })

    it('does nothing when not recording or micEnabled is false', async () => {
        const manager = createRecordingStateManager(
            vi.fn().mockResolvedValue({ isRecording: true, micEnabled: false }),
            vi.fn().mockResolvedValue(undefined),
        )
        const sendRuntimeMessage = vi.fn().mockResolvedValue(undefined)
        const onStateUpdated = vi.fn().mockResolvedValue(undefined)

        await toggleMicrophoneMute('keyboard-shortcut', manager, sendRuntimeMessage, onStateUpdated)

        expect(sendRuntimeMessage).not.toHaveBeenCalled()
        expect(onStateUpdated).not.toHaveBeenCalled()
    })

    it('gates mute shortcut invoked while start-recording is in flight without blocking getRecordingState', async () => {
        // Simulate leftover stored state from a previous session where mic was muted
        let storedState: RecordingState = {
            isRecording: true,
            startAtMs: 1000,
            micEnabled: true,
            isMicMuted: true,
        }
        let offscreenHashIsRecording = false

        const readState = vi.fn(async (): Promise<RecordingState> => {
            if (!offscreenHashIsRecording) return { isRecording: false }
            return { ...storedState, isRecording: true }
        })
        const writeState = vi.fn(async (nextState: RecordingState) => {
            storedState = { ...nextState }
        })

        const manager = createRecordingStateManager(readState, writeState)
        const sentMessages: Message[] = []

        // Start recording: offscreen publishes #recording before returning StartRecordingResponse
        let resolveStartResponse!: () => void
        const startResponseGate = new Promise<void>(resolve => {
            resolveStartResponse = resolve
        })

        const startPromise = startRecordingSession(
            {
                type: 'start-recording',
                trigger: 'action-icon',
                data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            },
            { width: 1920, height: 1080 },
            manager,
            async msg => {
                sentMessages.push(msg)
                // Offscreen sets #recording while IndexedDB writes are still in flight
                offscreenHashIsRecording = true
                await startResponseGate
                return {
                    startAtMs: 2000,
                    mainFilePath: 'video-2000.webm',
                    mimeType: 'video/webm',
                    recordingMode: 'video-and-audio',
                    micEnabled: true,
                }
            },
            vi.fn().mockResolvedValue(undefined),
        )

        // Wait until offscreen has set #recording (while start-recording is still in flight)
        await vi.waitFor(() => {
            expect(offscreenHashIsRecording).toBe(true)
        })

        // getRecordingState is not blocked and returns { isRecording: false } while starting
        expect(await manager.getRecordingState()).toEqual({ isRecording: false })

        // User invokes mute shortcut during that startup interval — should be gated (ignored)
        // rather than reading the previous session's isMicMuted: true
        await toggleMicrophoneMute(
            'keyboard-shortcut',
            manager,
            async msg => {
                sentMessages.push(msg)
                return { isMicMuted: false }
            },
            vi.fn().mockResolvedValue(undefined),
        )

        expect(sentMessages).toEqual([
            {
                type: 'start-recording',
                trigger: 'action-icon',
                data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            },
        ])

        // Allow start-recording response to complete
        resolveStartResponse()
        await startPromise

        expect(storedState).toEqual({
            isRecording: true,
            screenSize: { width: 1920, height: 1080 },
            startAtMs: 2000,
            recordingMode: 'video-and-audio',
            micEnabled: true,
            stopAtMs: undefined,
        })
    })
})

describe('pause/resume session helpers', () => {
    it('pauseRecordingSession and resumeRecordingSession update state and accumulate totalPausedMs', async () => {
        let storedState: RecordingState = {
            isRecording: true,
            startAtMs: 1000,
            isPaused: false,
        }
        const manager = createRecordingStateManager(
            vi.fn(async () => ({ ...storedState })),
            vi.fn(async nextState => {
                storedState = { ...nextState }
            }),
        )
        const sendRuntimeMessage = vi.fn().mockResolvedValue(undefined)
        const onStateUpdated = vi.fn().mockResolvedValue(undefined)

        await pauseRecordingSession('keyboard-shortcut', manager, sendRuntimeMessage, onStateUpdated)
        expect(sendRuntimeMessage).toHaveBeenCalledWith({
            type: 'pause-recording',
            trigger: 'keyboard-shortcut',
        })
        expect(storedState.isPaused).toBe(true)
        expect(storedState.pausedAtMs).toEqual(expect.any(Number))

        await resumeRecordingSession('keyboard-shortcut', manager, sendRuntimeMessage, onStateUpdated)
        expect(sendRuntimeMessage).toHaveBeenCalledWith({
            type: 'resume-recording',
            trigger: 'keyboard-shortcut',
        })
        expect(storedState.isPaused).toBe(false)
        expect(storedState.pausedAtMs).toBeUndefined()
        expect(storedState.totalPausedMs).toEqual(expect.any(Number))
        expect(onStateUpdated).toHaveBeenCalledTimes(2)
    })

    it('togglePauseRecordingSession serializes overlapping toggles so two toggles pause then resume', async () => {
        let storedState: RecordingState = {
            isRecording: true,
            startAtMs: 1000,
            isPaused: false,
        }
        const manager = createRecordingStateManager(
            vi.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 10))
                return { ...storedState }
            }),
            vi.fn(async nextState => {
                await new Promise(resolve => setTimeout(resolve, 10))
                storedState = { ...nextState }
            }),
        )
        const sentMessages: Message[] = []
        const sendRuntimeMessage = vi.fn(async (msg: Message) => {
            await new Promise(resolve => setTimeout(resolve, 15))
            sentMessages.push(msg)
        })
        const onStateUpdated = vi.fn().mockResolvedValue(undefined)

        await Promise.all([
            togglePauseRecordingSession('keyboard-shortcut', manager, sendRuntimeMessage, onStateUpdated),
            togglePauseRecordingSession('context-menu', manager, sendRuntimeMessage, onStateUpdated),
        ])

        expect(sentMessages).toEqual([
            { type: 'pause-recording', trigger: 'keyboard-shortcut' },
            { type: 'resume-recording', trigger: 'context-menu' },
        ])
        expect(storedState.isPaused).toBe(false)
        expect(onStateUpdated).toHaveBeenCalledTimes(2)
    })
})
