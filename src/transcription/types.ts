export interface TranscriptionSegment {
    id: number
    start: number // seconds
    end: number // seconds
    formattedStart: string
    formattedEnd: string
    text: string
}

export interface VadStats {
    totalDuration: number
    speechDuration: number
    skippedSilenceDuration: number
    speechSegmentCount: number
}

export interface TranscriptionResult {
    text: string
    segments: TranscriptionSegment[]
    durationSeconds: number
    processingTimeMs: number
    totalTimeMs: number
    vadStats?: VadStats
}

export interface DownloadProgress {
    status: string
    name?: string
    file?: string
    progress?: number
    loaded?: number
    total?: number
}

export type WorkerInMessage =
    | {
          type: 'load'
          modelId: string
          device?: 'webgpu' | 'wasm' | 'auto'
      }
    | {
          type: 'transcribe-init'
          modelId: string
          device?: 'webgpu' | 'wasm' | 'auto'
          language?: string
          vadEnabled: boolean
          vadThreshold?: number
      }
    | {
          type: 'audio-chunk'
          chunk: Float32Array
      }
    | {
          type: 'audio-end'
      }
    | {
          type: 'transcribe'
          audio: Float32Array
          modelId: string
          language?: string
          vadEnabled: boolean
          vadThreshold?: number
          return_timestamps?: boolean
      }

export type WorkerOutMessage =
    | {
          type: 'status'
          message: string
          phase?: 'transcribing'
          detail?: string
      }
    | {
          type: 'download-progress'
          data: DownloadProgress
      }
    | {
          type: 'model-ready'
          modelId: string
          device: string
      }
    | {
          type: 'transcribe-start'
      }
    | {
          type: 'chunk-ack'
      }
    | {
          type: 'transcribe-segment'
          segment: TranscriptionSegment
      }
    | {
          type: 'transcribe-complete'
          result: TranscriptionResult
      }
    | {
          type: 'error'
          error: string
      }
