import type { RecordingMetadata, StorageEstimateInfo, ListRecordingsOptions } from './storage'
import type { ClaimClientsMessage } from './message'
import type { TranscriptionResult } from './transcription/types'
import type { SummaryResult } from './summary/types'

const API_BASE = '/api'
const CLAIM_TIMEOUT_MS = 2000

let ensureControlledPromise: Promise<void> | null = null

/**
 * Ensure the page is controlled by the service worker.
 * On hard reload, the page may lose SW control; this requests the SW to call clients.claim()
 * and waits for the controllerchange event.
 * Concurrent calls share the same in-flight promise so the claim is performed at most once.
 */
async function ensureControlled(): Promise<void> {
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller != null) return

    if (ensureControlledPromise != null) {
        await ensureControlledPromise
        return
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    let onControllerChange: (() => void) | undefined

    const cleanup = () => {
        ensureControlledPromise = null
        if (timeout !== undefined) {
            clearTimeout(timeout)
            timeout = undefined
        }
        if (onControllerChange !== undefined) {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
            onControllerChange = undefined
        }
    }

    ensureControlledPromise = (async () => {
        const controllerChanged = new Promise<void>((resolve, reject) => {
            let settled = false
            const resolveOnce = () => {
                if (settled) return
                settled = true
                resolve()
            }

            timeout = setTimeout(() => {
                if (settled) return
                settled = true
                reject(new Error('Timed out waiting for service worker to claim this client'))
            }, CLAIM_TIMEOUT_MS)

            onControllerChange = () => resolveOnce()
            navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true })

            if (navigator.serviceWorker.controller != null) {
                resolveOnce()
            }
        })

        const msg: ClaimClientsMessage = { type: 'claim-clients' }
        try {
            await chrome.runtime.sendMessage(msg)
            await controllerChanged
        } finally {
            cleanup()
        }
    })()

    await ensureControlledPromise
}

/**
 * API client for recording storage operations
 * Communicates with Service Worker via fetch interception
 */
export class RecordingApiClient {
    /**
     * Ensure the page is controlled by the service worker
     */
    async ensureControlled(): Promise<void> {
        await ensureControlled()
    }

    /**
     * List all recordings
     * @param options - Optional listing options including sort order
     */
    async listRecordings(options?: ListRecordingsOptions): Promise<RecordingMetadata[]> {
        await ensureControlled()
        const params = new URLSearchParams()
        if (options?.sort) {
            params.set('sort', options.sort)
        }
        const query = params.toString()
        const url = query ? `${API_BASE}/recordings?${query}` : `${API_BASE}/recordings`
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to list recordings: ${response.status}`)
        }
        return response.json()
    }

    /**
     * Get the file blob for a recording
     */
    async getRecordingFile(name: string): Promise<Blob | null> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}`)
        if (response.status === 404) {
            return null
        }
        if (!response.ok) {
            throw new Error(`Failed to get recording file: ${response.status}`)
        }
        return response.blob()
    }

    /**
     * Delete a recording (idempotent, cascade deletes sub-files and IndexedDB record)
     */
    async deleteRecording(name: string): Promise<void> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}`, {
            method: 'DELETE',
        })
        if (response.status === 204) {
            return
        }
        if (!response.ok) {
            throw new Error(`Failed to delete recording: ${response.status}`)
        }
    }

    /**
     * Get transcription for a recording
     */
    async getTranscription(name: string): Promise<TranscriptionResult | null> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}/transcription`)
        if (response.status === 404) {
            return null
        }
        if (!response.ok) {
            throw new Error(`Failed to get transcription: ${response.status}`)
        }
        return response.json()
    }

    /**
     * Save transcription for a recording
     */
    async saveTranscription(name: string, transcription: TranscriptionResult): Promise<void> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}/transcription`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(transcription),
        })
        if (response.status === 204 || response.ok) {
            return
        }
        throw new Error(`Failed to save transcription: ${response.status}`)
    }

    /**
     * Delete transcription for a recording
     */
    async deleteTranscription(name: string): Promise<void> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}/transcription`, {
            method: 'DELETE',
        })
        if (response.status === 204 || response.ok) {
            return
        }
        throw new Error(`Failed to delete transcription: ${response.status}`)
    }

    /**
     * Get summary for a recording
     */
    async getSummary(name: string): Promise<SummaryResult | null> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}/summary`)
        if (response.status === 404) {
            return null
        }
        if (!response.ok) {
            throw new Error(`Failed to get summary: ${response.status}`)
        }
        return response.json()
    }

    /**
     * Save summary for a recording
     */
    async saveSummary(name: string, summary: SummaryResult): Promise<void> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}/summary`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(summary),
        })
        if (response.status === 204 || response.ok) {
            return
        }
        throw new Error(`Failed to save summary: ${response.status}`)
    }

    /**
     * Delete summary for a recording
     */
    async deleteSummary(name: string): Promise<void> {
        await ensureControlled()
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}/summary`, {
            method: 'DELETE',
        })
        if (response.status === 204 || response.ok) {
            return
        }
        throw new Error(`Failed to delete summary: ${response.status}`)
    }

    /**
     * Get storage estimate
     */
    async getStorageEstimate(): Promise<StorageEstimateInfo> {
        await ensureControlled()
        const response = await fetch(`${API_BASE}/storage/estimate`)
        if (!response.ok) {
            throw new Error(`Failed to get storage estimate: ${response.status}`)
        }
        return response.json()
    }
}

/**
 * Default API client instance
 */
export const recordingApi = new RecordingApiClient()
