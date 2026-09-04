import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/switch/switch'
import { MdSwitch } from '@material/web/switch/switch'
import { applyTheme } from './theme'
import { Settings } from './element/settings'

interface ParsedCue {
    id: string
    start: number
    end: number
    text: string
    timeText: string
}

function parseVttTime(timeStr: string): number {
    const parts = timeStr.trim().split(':')
    if (parts.length === 3) {
        const [hh, mm, ss] = parts
        return Number.parseFloat(hh) * 3600 + Number.parseFloat(mm) * 60 + Number.parseFloat(ss)
    } else if (parts.length === 2) {
        const [mm, ss] = parts
        return Number.parseFloat(mm) * 60 + Number.parseFloat(ss)
    }
    return 0
}

function parseWebVTT(vttText: string): ParsedCue[] {
    const cues: ParsedCue[] = []
    const lines = vttText.split(/\r?\n/)

    let currentId = ''
    let currentTimeLine = ''
    let currentTextLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line === 'WEBVTT' || line.startsWith('NOTE')) continue

        if (line.includes('-->')) {
            currentTimeLine = line
        } else if (currentTimeLine && line !== '') {
            currentTextLines.push(line)
        } else if (line === '' && currentTimeLine) {
            const [startStr, endStr] = currentTimeLine.split('-->').map(s => s.trim())
            cues.push({
                id: currentId || String(cues.length + 1),
                start: parseVttTime(startStr),
                end: parseVttTime(endStr),
                text: currentTextLines.join('\n'),
                timeText: startStr.split('.')[0],
            })
            currentId = ''
            currentTimeLine = ''
            currentTextLines = []
        } else if (!currentTimeLine && line !== '') {
            currentId = line
        }
    }

    if (currentTimeLine && currentTextLines.length > 0) {
        const [startStr, endStr] = currentTimeLine.split('-->').map(s => s.trim())
        cues.push({
            id: currentId || String(cues.length + 1),
            start: parseVttTime(startStr),
            end: parseVttTime(endStr),
            text: currentTextLines.join('\n'),
            timeText: startStr.split('.')[0],
        })
    }

    return cues
}

async function initPlayer() {
    const config = Settings.getConfiguration()
    applyTheme(config.uiTheme)

    const params = new URLSearchParams(window.location.search)
    const fileName = params.get('file')
    if (!fileName) {
        const container = document.getElementById('player-container')
        if (container) container.innerHTML = '<div style="color: white; padding: 24px;">No file specified.</div>'
        return
    }

    const titleEl = document.getElementById('file-title')
    if (titleEl) titleEl.textContent = fileName
    document.title = `${fileName} - Player`

    const fileUrl = `/api/recordings/${encodeURIComponent(fileName)}`
    const isAudio = fileName.endsWith('.ogg') || fileName.endsWith('.aac') || fileName.endsWith('.flac')

    const playerContainer = document.getElementById('player-container')
    if (!playerContainer) return

    let mediaEl: HTMLVideoElement | HTMLAudioElement
    if (isAudio) {
        mediaEl = document.createElement('audio')
    } else {
        mediaEl = document.createElement('video')
        mediaEl.playsInline = true
    }
    mediaEl.controls = true
    mediaEl.autoplay = true
    mediaEl.src = fileUrl
    playerContainer.appendChild(mediaEl)

    // Check for WebVTT transcript file
    const vttName = fileName.replace(/\.[^.]+$/, '.vtt')
    const vttUrl = `/api/recordings/${encodeURIComponent(vttName)}`

    try {
        const vttRes = await fetch(vttUrl)
        if (vttRes.ok) {
            const vttText = await vttRes.text()

            // Add track element
            const trackEl = document.createElement('track')
            trackEl.kind = 'subtitles'
            trackEl.src = vttUrl
            trackEl.srclang = 'ja'
            trackEl.label = 'Subtitles'
            trackEl.default = true
            mediaEl.appendChild(trackEl)

            // Setup subtitle switch
            const switchContainer = document.getElementById('subtitle-switch-container')
            const subtitleSwitch = document.getElementById('subtitle-switch') as MdSwitch | null
            if (switchContainer && subtitleSwitch) {
                switchContainer.style.display = 'flex'
                subtitleSwitch.selected = true

                subtitleSwitch.addEventListener('input', () => {
                    const textTracks = mediaEl.textTracks
                    if (textTracks && textTracks.length > 0) {
                        textTracks[0].mode = subtitleSwitch.selected ? 'showing' : 'hidden'
                    }
                })
            }

            // Setup download buttons
            const downloadPanel = document.getElementById('download-actions')
            const vttBtn = document.getElementById('download-vtt-btn')
            const srtBtn = document.getElementById('download-srt-btn')

            if (downloadPanel) downloadPanel.style.display = 'flex'

            if (vttBtn) {
                vttBtn.addEventListener('click', () => {
                    window.location.href = `${vttUrl}?download=true`
                })
            }

            if (srtBtn) {
                const srtName = fileName.replace(/\.[^.]+$/, '.srt')
                const srtUrl = `/api/recordings/${encodeURIComponent(srtName)}?download=true`
                srtBtn.addEventListener('click', () => {
                    window.location.href = srtUrl
                })
            }

            // Setup transcript panel
            const transcriptSection = document.getElementById('transcript-section')
            const transcriptList = document.getElementById('transcript-list')
            const transcriptToggle = document.getElementById('transcript-toggle')
            const transcriptArrow = document.getElementById('transcript-arrow')

            if (transcriptSection && transcriptList) {
                const cues = parseWebVTT(vttText)
                if (cues.length > 0) {
                    transcriptSection.style.display = 'block'
                    transcriptList.innerHTML = cues
                        .map(
                            cue => `
                        <div class="transcript-item" data-start="${cue.start}">
                            <div class="transcript-time">${cue.timeText}</div>
                            <div class="transcript-text">${cue.text}</div>
                        </div>
                    `,
                        )
                        .join('')

                    // Click item to seek
                    transcriptList.querySelectorAll('.transcript-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const start = Number.parseFloat(item.getAttribute('data-start') || '0')
                            mediaEl.currentTime = start
                            mediaEl.play()
                        })
                    })

                    // Highlight active item during playback
                    mediaEl.addEventListener('timeupdate', () => {
                        const curTime = mediaEl.currentTime
                        transcriptList.querySelectorAll('.transcript-item').forEach(item => {
                            const start = Number.parseFloat(item.getAttribute('data-start') || '0')
                            const nextStart = Number.parseFloat(
                                item.nextElementSibling?.getAttribute('data-start') || '999999',
                            )
                            if (curTime >= start && curTime < nextStart) {
                                item.style.backgroundColor = 'rgba(0, 106, 106, 0.12)'
                            } else {
                                item.style.backgroundColor = ''
                            }
                        })
                    })
                }

                if (transcriptToggle && transcriptArrow) {
                    let isOpen = true
                    transcriptToggle.addEventListener('click', () => {
                        isOpen = !isOpen
                        transcriptList.style.display = isOpen ? 'block' : 'none'
                        transcriptArrow.textContent = isOpen ? 'expand_more' : 'expand_less'
                    })
                }
            }
        }
    } catch (e) {
        console.warn('Transcript not available:', e)
    }
}

document.addEventListener('DOMContentLoaded', initPlayer)
