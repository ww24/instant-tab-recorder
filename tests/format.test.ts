import { formatHHMM, buildRecordingTitle, formatElapsedTime } from '../src/format'
import type { RecordingState } from '../src/handler'

describe('formatHHMM', () => {
    it('returns 00:00 for 0 ms', () => {
        expect(formatHHMM(0)).toBe('00:00')
    })

    it('returns 00:00 for negative values', () => {
        expect(formatHHMM(-1000)).toBe('00:00')
    })

    it('returns 00:01 for 1 minute', () => {
        expect(formatHHMM(60_000)).toBe('00:01')
    })

    it('returns 00:00 for 59 seconds (rounds down by default)', () => {
        expect(formatHHMM(59_999)).toBe('00:00')
    })

    it('returns 01:00 for 1 hour', () => {
        expect(formatHHMM(3_600_000)).toBe('01:00')
    })

    it('returns 01:30 for 1.5 hours', () => {
        expect(formatHHMM(5_400_000)).toBe('01:30')
    })

    it('returns 23:59 for exactly 23:59', () => {
        expect(formatHHMM(23 * 3_600_000 + 59 * 60_000)).toBe('23:59')
    })

    it('returns 23:59+ when exceeding 23:59', () => {
        expect(formatHHMM(24 * 3_600_000)).toBe('23:59+')
    })

    it('returns 23:59+ for very large values', () => {
        expect(formatHHMM(100 * 3_600_000)).toBe('23:59+')
    })

    it('rounds up with ceil rounding', () => {
        expect(formatHHMM(59_999, 'ceil')).toBe('00:01')
    })

    it('returns 00:00 for 0 ms with ceil rounding', () => {
        expect(formatHHMM(0, 'ceil')).toBe('00:00')
    })

    it('returns 00:00 for negative values with ceil rounding', () => {
        expect(formatHHMM(-1000, 'ceil')).toBe('00:00')
    })
})

describe('formatElapsedTime', () => {
    it('returns 00:00:00 for 0 ms', () => {
        expect(formatElapsedTime(0)).toBe('00:00:00')
    })

    it('returns 00:00:00 for negative values', () => {
        expect(formatElapsedTime(-5000)).toBe('00:00:00')
    })

    it('returns 00:00:01 for 1 second', () => {
        expect(formatElapsedTime(1_000)).toBe('00:00:01')
    })

    it('returns 00:00:59 for 59 seconds', () => {
        expect(formatElapsedTime(59_000)).toBe('00:00:59')
    })

    it('returns 00:01:00 for 1 minute', () => {
        expect(formatElapsedTime(60_000)).toBe('00:01:00')
    })

    it('returns 00:01:30 for 1 minute 30 seconds', () => {
        expect(formatElapsedTime(90_000)).toBe('00:01:30')
    })

    it('returns 01:00:00 for 1 hour', () => {
        expect(formatElapsedTime(3_600_000)).toBe('01:00:00')
    })

    it('returns 12:34:56 for 12h 34m 56s', () => {
        expect(formatElapsedTime(12 * 3_600_000 + 34 * 60_000 + 56_000)).toBe('12:34:56')
    })

    it('returns 23:59:59 for exactly 23:59:59', () => {
        expect(formatElapsedTime(23 * 3_600_000 + 59 * 60_000 + 59_000)).toBe('23:59:59')
    })

    it('returns 23:59:59+ when exceeding 23:59:59', () => {
        expect(formatElapsedTime(24 * 3_600_000)).toBe('23:59:59+')
    })

    it('returns 23:59:59+ for very large values', () => {
        expect(formatElapsedTime(100 * 3_600_000)).toBe('23:59:59+')
    })

    it('rounds down sub-second values', () => {
        expect(formatElapsedTime(1_999)).toBe('00:00:01')
    })
})

describe('buildRecordingTitle', () => {
    const appName = 'Instant Tab Recorder'
    const baseState: RecordingState = {
        isRecording: true,
        startAtMs: 1000,
        recordingMode: 'video-and-audio',
        micEnabled: false,
    }

    it('shows video: on / audio: on / mic: off for video-and-audio mode', () => {
        const title = buildRecordingTitle(appName, baseState, 1000)
        expect(title).toBe(
            [
                'Instant Tab Recorder',
                'Recording (00:00)',
                'video: on / audio: on / mic: off',
                'Click to stop recording.',
            ].join('\n'),
        )
    })

    it('shows video: on / audio: off / mic: off for video-only mode', () => {
        const state: RecordingState = { ...baseState, recordingMode: 'video-only' }
        const title = buildRecordingTitle(appName, state, 1000)
        expect(title).toContain('video: on / audio: off / mic: off')
    })

    it('shows video: off / audio: on / mic: off for audio-only mode', () => {
        const state: RecordingState = { ...baseState, recordingMode: 'audio-only' }
        const title = buildRecordingTitle(appName, state, 1000)
        expect(title).toContain('video: off / audio: on / mic: off')
    })

    it('shows mic: on when micEnabled is true', () => {
        const state: RecordingState = { ...baseState, micEnabled: true }
        const title = buildRecordingTitle(appName, state, 1000)
        expect(title).toContain('mic: on')
    })

    it('shows mic: muted when micEnabled is true and isMicMuted is true', () => {
        const state: RecordingState = { ...baseState, micEnabled: true, isMicMuted: true }
        const title = buildRecordingTitle(appName, state, 1000)
        expect(title).toContain('mic: muted')
    })

    it('shows mic: off when micEnabled is false even if isMicMuted is true', () => {
        const state: RecordingState = { ...baseState, micEnabled: false, isMicMuted: true }
        const title = buildRecordingTitle(appName, state, 1000)
        expect(title).toContain('mic: off')
    })

    it('shows elapsed time based on startAtMs and now', () => {
        const state: RecordingState = { ...baseState, startAtMs: 0 }
        const title = buildRecordingTitle(appName, state, 90 * 60_000) // 90 minutes
        expect(title).toContain('Recording (01:30)')
    })

    it('shows 00:00 when startAtMs is undefined', () => {
        const state: RecordingState = { ...baseState, startAtMs: undefined }
        const title = buildRecordingTitle(appName, state, 999999)
        expect(title).toContain('Recording (00:00)')
    })

    it('defaults to video on / audio on / mic off when mode is undefined', () => {
        const state: RecordingState = { isRecording: true }
        const title = buildRecordingTitle(appName, state, 0)
        expect(title).toContain('video: on / audio: on / mic: off')
    })

    it('shows Paused instead of Recording when isPaused is true', () => {
        const state: RecordingState = { ...baseState, isPaused: true }
        const title = buildRecordingTitle(appName, state, 1000)
        expect(title).toContain('Paused (00:00)')
        expect(title).not.toContain('Recording')
    })

    it('subtracts totalPausedMs from elapsed time', () => {
        const state: RecordingState = { ...baseState, startAtMs: 0, totalPausedMs: 30 * 60_000 }
        const title = buildRecordingTitle(appName, state, 90 * 60_000)
        // 90 min wall - 30 min paused = 60 min elapsed = 01:00
        expect(title).toContain('Recording (01:00)')
    })

    it('shows Paused with correct elapsed time minus paused time', () => {
        const state: RecordingState = {
            ...baseState,
            startAtMs: 0,
            isPaused: true,
            totalPausedMs: 10 * 60_000,
            pausedAtMs: 50 * 60_000,
        }
        const title = buildRecordingTitle(appName, state, 60 * 60_000)
        // 60 min wall - 10 min previous paused - 10 min current pause (60-50) = 40 min elapsed
        expect(title).toContain('Paused (00:40)')
    })

    it('includes current pause duration from pausedAtMs', () => {
        const state: RecordingState = { ...baseState, startAtMs: 0, isPaused: true, pausedAtMs: 20 * 60_000 }
        const title = buildRecordingTitle(appName, state, 30 * 60_000)
        // 30 min wall - 10 min current pause (30-20) = 20 min elapsed
        expect(title).toContain('Paused (00:20)')
    })

    it('shows timer remaining when recording', () => {
        const state: RecordingState = { ...baseState, stopAtMs: 60 * 60_000 }
        const title = buildRecordingTitle(appName, state, 30 * 60_000)
        expect(title).toContain('Timer: 00:30 remaining')
        expect(title).not.toContain('paused')
    })

    it('shows timer paused with frozen remaining time when isPaused', () => {
        // stopAtMs was set before pause, pausedAtMs is when pause started
        const state: RecordingState = { ...baseState, isPaused: true, pausedAtMs: 30 * 60_000, stopAtMs: 60 * 60_000 }
        const title = buildRecordingTitle(appName, state, 45 * 60_000)
        // Remaining should be frozen at stopAtMs - pausedAtMs = 30 min, not stopAtMs - now = 15 min
        expect(title).toContain('Timer: paused (00:30 remaining)')
    })
})
