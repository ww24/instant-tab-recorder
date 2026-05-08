vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import { handleMessage, createMessageListener, type ServiceWorkerDeps } from '../src/service_worker_handler'
import type { Message } from '../src/message'
import type { RecordingState } from '../src/handler'
import type { Configuration } from '../src/configuration'

// ---------- helpers ----------

function createMockDeps(overrides: Partial<ServiceWorkerDeps> = {}): ServiceWorkerDeps {
    return {
        getRecordingState: vi.fn().mockResolvedValue({ isRecording: false }),
        setRecordingState: vi.fn().mockResolvedValue(undefined),
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
