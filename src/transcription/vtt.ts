import type { TranscriptionSegment } from './types'

const pad = (n: number, z = 2) => n.toString().padStart(z, '0')

/**
 * Formats seconds into WebVTT timestamp: HH:MM:SS.mmm
 */
export function formatVttTimestamp(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00:00.000'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)

    return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`
}

/**
 * Formats seconds into SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(seconds: number): string {
    return formatVttTimestamp(seconds).replace('.', ',')
}

/**
 * Generates WebVTT string from transcription segments
 */
export function segmentsToVtt(segments: TranscriptionSegment[]): string {
    let vtt = 'WEBVTT\n\n'
    for (const seg of segments) {
        vtt += `${seg.id}\n`
        vtt += `${formatVttTimestamp(seg.start)} --> ${formatVttTimestamp(seg.end)}\n`
        vtt += `${seg.text.trim()}\n\n`
    }
    return vtt
}

/**
 * Converts WebVTT string to SubRip (SRT) format
 */
export function vttToSrt(vtt: string): string {
    const lines = vtt.split(/\r?\n/)
    const srtLines: string[] = []

    let inHeader = true
    for (const line of lines) {
        if (inHeader) {
            if (line.trim() === '' || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
                if (line.trim() === '' && srtLines.length === 0) {
                    inHeader = false
                }
                continue
            }
            inHeader = false
        }

        // Replace timestamps from 00:00:00.000 to 00:00:00,000
        if (line.includes('-->')) {
            const converted = line.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
            srtLines.push(converted)
        } else {
            srtLines.push(line)
        }
    }

    return srtLines.join('\n').trim() + '\n'
}

/**
 * Generates SRT string directly from transcription segments
 */
export function segmentsToSrt(segments: TranscriptionSegment[]): string {
    let srt = ''
    for (const seg of segments) {
        srt += `${seg.id}\n`
        srt += `${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}\n`
        srt += `${seg.text.trim()}\n\n`
    }
    return srt
}
