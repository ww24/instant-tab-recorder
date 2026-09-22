import type { StartTrigger, Trigger } from './message'

export interface ExceptionMetadata {
    exceptionSource: string
    additionalMetadata?: Record<string, string>
}

export type Event =
    | StartRecordingEvent
    | StopRecordingEvent
    | UnexpectedStopEvent
    | ClickExternalLinkEvent
    | MigrationStartEvent
    | MigrationEndEvent
    | AgreeTermsEvent
    | TranscriptionCompleteEvent
    | ModelDownloadCompleteEvent

export interface AgreeTermsEvent {
    type: 'agree_terms'
}

export interface StartRecordingEvent {
    type: 'start_recording'
    tags: {
        trigger: StartTrigger
    }
}

export interface StopRecordingEvent {
    type: 'stop_recording'
    metrics: {
        trigger: Trigger
        recording: {
            durationSec: number
            filesize: number
        }
    }
}

export interface UnexpectedStopEvent {
    type: 'unexpected_stop'
    metrics: {
        recording: {
            durationSec: number
        }
    }
}

export interface ClickExternalLinkEvent {
    type: 'click_external_link'
    tags: {
        link: 'support' | 'review' | 'terms' | 'privacy'
    }
}

export interface MigrationStartEvent {
    type: 'migration_start'
    metrics: {
        opfsMainFileCount: number
        idbRecordCount: number
    }
}

export interface MigrationEndEvent {
    type: 'migration_end'
    metrics: {
        inserted: number
        durationMs: number
    }
}

export interface TranscriptionCompleteEvent {
    type: 'transcription_complete'
    metrics: {
        /** Video duration in seconds */
        videoDurationSec: number
        /** Audio conversion time in milliseconds (Mediabunny PCM extraction) */
        audioConversionMs: number
        /** Model load time in milliseconds */
        modelLoadMs: number
        /** Loudness normalization time in milliseconds */
        loudnessNormMs: number
        /** VAD speech detection time in milliseconds */
        vadMs: number
        /** Audio speech recognition inference time in milliseconds */
        inferenceMs: number
        /** Total time in milliseconds */
        totalMs: number
        /** Model ID used for transcription */
        modelId: string
        /** Language used for transcription */
        language: string
        /** Number of generated segments */
        segmentCount: number
    }
}

export interface ModelDownloadCompleteEvent {
    type: 'model_download_complete'
    metrics: {
        /** Total download time in milliseconds */
        totalMs: number
    }
}
