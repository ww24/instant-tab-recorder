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

export interface AgreeTermsEvent {
    type: 'agree_terms'
}

export interface StartRecordingEvent {
    type: 'start_recording'
    tags: {
        trigger: StartTrigger
        state: {
            opfsPersisted: boolean
        }
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
        link: 'support' | 'review'
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
