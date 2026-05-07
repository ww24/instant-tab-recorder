import type { Resolution, Configuration, SyncConfiguration, CropRegion, VideoRecordingMode } from './configuration'
import type { RecordingState } from './handler'

export const TIMER_STOP_CONFIRM_PENDING_KEY = 'timerStopConfirmPending'
export const TIMER_STOP_TRIGGER_KEY = 'timerStopTrigger'

export type Message =
    | ExceptionMessage
    | SentryEventMessage
    | StartRecordingMessage
    | TabTrackEndedMessage
    | StopRecordingMessage
    | PauseRecordingMessage
    | ResumeRecordingMessage
    | UnexpectedRecordingStateMessage
    | CancelRecordingMessage
    | ResizeWindowMessage
    | FetchConfigMessage
    | SaveConfigLocalMessage
    | SaveConfigSyncMessage
    | RecordingStateMessage
    | RequestRecordingStateMessage
    | PreviewFrameMessage
    | PreviewControlMessage
    | UpdateCropRegionMessage
    | RecordingTickMessage
    | TimerExpiredMessage
    | TimerUpdatedMessage
    | ConfirmTimerStopMessage
    | UpdateRecordingTimerMessage
    | ClaimClientsMessage

export interface ExceptionMessage {
    type: 'exception'
    data: unknown
}

export interface SentryEventMessage {
    type: 'sentry-event'
    event: import('./sentry_event').Event
}

export type Trigger = 'action-icon' | 'context-menu' | 'keyboard-shortcut' | 'tab-track-ended' | 'timer'

export type StartTrigger = Exclude<Trigger, 'tab-track-ended' | 'timer'>

export interface StartRecordingMessage {
    type: 'start-recording'
    data: StartRecording
    trigger: StartTrigger
}
export interface StartRecording {
    tabSize: Resolution
    streamId: string
}
export interface StartRecordingResponse {
    startAtMs: number
    mainFilePath: string
    mimeType: string
    recordingMode: VideoRecordingMode
    micEnabled: boolean
    stopAtMs?: number
}

export interface TabTrackEndedMessage {
    type: 'tab-track-ended'
}

export interface StopRecordingMessage {
    type: 'stop-recording'
    trigger: Trigger
}

export interface PauseRecordingMessage {
    type: 'pause-recording'
    trigger: Trigger
}

export interface ResumeRecordingMessage {
    type: 'resume-recording'
    trigger: Trigger
}

export interface UnexpectedRecordingStateMessage {
    type: 'unexpected-recording-state'
    error: string
}

export interface CancelRecordingMessage {
    type: 'cancel-recording'
}

export interface ResizeWindowMessage {
    type: 'resize-window'
    data: Resolution
}

export interface FetchConfigMessage {
    type: 'fetch-config'
}

export interface SaveConfigLocalMessage {
    type: 'save-config-local'
    data: Configuration
}

export interface SaveConfigSyncMessage {
    type: 'save-config-sync'
    data: SyncConfiguration
}

// Recording state notification (service_worker → option page)
export interface RecordingStateMessage {
    type: 'recording-state'
    data: RecordingState
}

// Request current recording state (option page → service_worker)
export interface RequestRecordingStateMessage {
    type: 'request-recording-state'
}

// Preview frame transfer (offscreen → service_worker → option page)
export interface PreviewFrameMessage {
    type: 'preview-frame'
    recordingSize: Resolution
    image: string // base64 encoded jpeg image
}

// Preview start/stop request (option page → service_worker → offscreen)
export interface PreviewControlMessage {
    type: 'preview-control'
    action: 'start' | 'stop'
}

// Cropping region update (option page → service_worker → offscreen)
export interface UpdateCropRegionMessage {
    type: 'update-crop-region'
    region: CropRegion
}

// Periodic tick during recording (offscreen → service_worker)
export interface RecordingTickMessage {
    type: 'recording-tick'
}

// Timer expired notification (offscreen → service_worker)
export interface TimerExpiredMessage {
    type: 'timer-expired'
}

// Timer updated notification (offscreen → service_worker)
export interface TimerUpdatedMessage {
    type: 'timer-updated'
    stopAtMs: number | null
}

// Confirm timer stop (option page → service_worker)
export interface ConfirmTimerStopMessage {
    type: 'confirm-timer-stop'
    trigger: Trigger
}

// Update recording timer (option page → offscreen)
export interface UpdateRecordingTimerMessage {
    type: 'update-recording-timer'
    enabled: boolean
    durationMinutes: number
}

// Request service worker to claim clients (option page → service_worker)
export interface ClaimClientsMessage {
    type: 'claim-clients'
}
