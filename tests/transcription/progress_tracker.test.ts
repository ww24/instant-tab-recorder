import { describe, it, expect } from 'vitest'
import { ModelLoadProgressTracker, SILERO_VAD_TOTAL_BYTES } from '../../src/transcription/progress_tracker'
import { WHISPER_TOTAL_BYTES } from '../../src/transcription/opfs_cache'

describe('ModelLoadProgressTracker', () => {
    it('initializes with accurate totalBytes for Whisper and VAD', () => {
        const trackerWithVad = new ModelLoadProgressTracker(true)
        expect(trackerWithVad.getTotalBytes()).toBe(WHISPER_TOTAL_BYTES + SILERO_VAD_TOTAL_BYTES)

        const trackerWithoutVad = new ModelLoadProgressTracker(false)
        expect(trackerWithoutVad.getTotalBytes()).toBe(WHISPER_TOTAL_BYTES)
    })

    it('computes overall progress smoothly and monotonically across file transitions', () => {
        const tracker = new ModelLoadProgressTracker(false)
        const total = tracker.getTotalBytes()

        // 1. Small initial config.json (1332 bytes)
        const p1 = tracker.track('whisper', {
            status: 'progress',
            file: 'config.json',
            loaded: 1332,
            total: 1332,
            progress: 100,
        })
        expect(p1.loaded).toBe(1332)
        expect(p1.progress).toBeCloseTo((1332 / total) * 100, 2)
        expect(p1.file).toBe('config.json')

        // 2. Next file starts: encoder_model_fp16.onnx (~1.27GB) at 10% of itself
        // In the old implementation, this would reset progress to 10%!
        const encoderSize = 1274342603
        const loadedEncoder = Math.round(encoderSize * 0.5) // 50% of encoder
        const p2 = tracker.track('whisper', {
            status: 'progress',
            file: 'onnx/encoder_model_fp16.onnx',
            loaded: loadedEncoder,
            total: encoderSize,
            progress: 50,
        })

        // Overall progress should be (1332 + loadedEncoder) / total
        const expectedPercent = ((1332 + loadedEncoder) / total) * 100
        expect(p2.loaded).toBe(1332 + loadedEncoder)
        expect(p2.progress).toBeCloseTo(expectedPercent, 2)
        expect(p2.progress).toBeGreaterThan(p1.progress)
        expect(p2.file).toBe('encoder_model_fp16.onnx')

        // 3. Encoder finishes
        const p3 = tracker.track('whisper', {
            status: 'done',
            file: 'onnx/encoder_model_fp16.onnx',
            loaded: encoderSize,
            total: encoderSize,
            progress: 100,
        })
        expect(p3.progress).toBeGreaterThan(p2.progress)

        // 4. Decoder starts: decoder_model_merged_q4.onnx at 5%
        // Progress MUST NOT drop backwards
        const decoderSize = 334147222
        const p4 = tracker.track('whisper', {
            status: 'progress',
            file: 'onnx/decoder_model_merged_q4.onnx',
            loaded: Math.round(decoderSize * 0.05),
            total: decoderSize,
            progress: 5,
        })
        expect(p4.progress).toBeGreaterThanOrEqual(p3.progress)
    })

    it('tracks VAD progress and reaches 100% on complete', () => {
        const tracker = new ModelLoadProgressTracker(true)

        // Mark Whisper complete
        const pWhisperDone = tracker.markModelComplete('whisper')
        expect(pWhisperDone.progress).toBeCloseTo(
            (WHISPER_TOTAL_BYTES / (WHISPER_TOTAL_BYTES + SILERO_VAD_TOTAL_BYTES)) * 100,
            1,
        )

        // Track VAD file
        tracker.track('vad', {
            status: 'progress',
            file: 'models/silero-vad/onnx/model.onnx',
            loaded: 1000000,
            total: 2318178,
            progress: 43,
        })

        // Mark VAD complete
        const pVadDone = tracker.markModelComplete('vad')
        expect(pVadDone.progress).toBe(100)
        expect(pVadDone.loaded).toBe(tracker.getTotalBytes())
    })

    it('handles unexpected or empty progress objects gracefully', () => {
        const tracker = new ModelLoadProgressTracker(false)
        const pNull = tracker.track('whisper', null)
        expect(pNull.progress).toBe(0)
        expect(pNull.status).toBe('progress')

        const pEmpty = tracker.track('whisper', {})
        expect(pEmpty.progress).toBe(0)
    })
})
