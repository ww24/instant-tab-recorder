import type { RecordingState } from './handler'
import { t } from './i18n'

/**
 * Format milliseconds as hh:mm for tooltip display.
 * Clamps at 23:59 and appends '+' if exceeded.
 * @param rounding - 'floor' for elapsed time, 'ceil' for remaining time
 */
export function formatHHMM(ms: number, rounding: 'floor' | 'ceil' = 'floor'): string {
    const MAX_MINUTES = 24 * 60 - 1 // 23:59
    const round = rounding === 'ceil' ? Math.ceil : Math.floor
    const rawMinutes = Math.max(0, round(ms / 60000))
    const totalMinutes = Math.min(rawMinutes, MAX_MINUTES)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const suffix = rawMinutes > MAX_MINUTES ? '+' : ''
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}${suffix}`
}

/**
 * Build the recording tooltip title string.
 * Uses a fixed timestamp so the caller controls the current time.
 */
export function buildRecordingTitle(appName: string, state: RecordingState, now: number = Date.now()): string {
    const currentPauseDuration = state.isPaused && state.pausedAtMs != null ? now - state.pausedAtMs : 0
    const totalPausedMs = (state.totalPausedMs ?? 0) + currentPauseDuration
    const elapsed = state.startAtMs != null ? formatHHMM(now - state.startAtMs - totalPausedMs) : '00:00'
    const status = state.isPaused ? t('formatPaused', elapsed) : t('formatRecording', elapsed)
    const on = t('formatOn')
    const off = t('formatOff')
    const muted = t('formatMuted')
    const video = state.recordingMode !== 'audio-only' ? on : off
    const audio = state.recordingMode !== 'video-only' ? on : off
    const mic = state.micEnabled ? (state.isMicMuted ? muted : on) : off
    const timerLine =
        state.stopAtMs != null
            ? state.isPaused
                ? t('formatTimerPaused', formatHHMM(state.stopAtMs - (state.pausedAtMs ?? now), 'ceil'))
                : t('formatTimerRemaining', formatHHMM(state.stopAtMs - now, 'ceil'))
            : null
    return [
        appName,
        status,
        t('formatVideoAudioMic', [video, audio, mic]),
        ...(timerLine ? [timerLine] : []),
        t('formatClickToStop'),
    ].join('\n')
}

/**
 * Format elapsed milliseconds as hh:mm:ss for record list display.
 * Clamps at 23:59:59 and appends '+' if exceeded.
 */
export function formatElapsedTime(elapsedMs: number): string {
    const MAX_SECONDS = 24 * 3600 - 1 // 23:59:59
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const clamped = Math.min(totalSeconds, MAX_SECONDS)
    const hours = Math.floor(clamped / 3600)
    const minutes = Math.floor((clamped % 3600) / 60)
    const seconds = clamped % 60
    const suffix = totalSeconds > MAX_SECONDS ? '+' : ''
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${suffix}`
}

export function formatNum(num: number, dig: number): string {
    return num.toLocaleString('en-US', {
        maximumFractionDigits: dig,
        minimumFractionDigits: dig,
    })
}

export function formatFileSize(bytes: number, fractionDigits: number = 2): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let unitIndex = 0
    let size = bytes
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex++
    }
    return `${formatNum(size, unitIndex === 0 ? 0 : fractionDigits)} ${units[unitIndex]}`
}
