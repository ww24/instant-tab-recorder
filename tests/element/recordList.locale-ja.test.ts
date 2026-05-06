import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getChromeMock } from './test-setup'
import jaMessages from '../../extension/_locales/ja/messages.json'

type MessageEntry = { message: string; placeholders?: Record<string, { content: string }> }
const messages = jaMessages as Record<string, MessageEntry>

function mockGetMessageJa(key: string, substitutions?: string | string[]): string {
    const entry = messages[key]
    if (!entry) return ''
    let result = entry.message
    if (substitutions != null) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions]
        for (let i = 0; i < subs.length; i++) {
            result = result.replace(new RegExp(`\\$${i + 1}\\$`, 'g'), () => subs[i])
        }
        if (entry.placeholders) {
            for (const [name, ph] of Object.entries(entry.placeholders)) {
                const idx = parseInt(ph.content.replace(/\$/g, ''), 10) - 1
                if (idx >= 0 && idx < subs.length) {
                    result = result.replace(new RegExp(`\\$${name}\\$`, 'gi'), () => subs[idx])
                }
            }
        }
    }
    return result
}

// Mock dependencies
const listRecordingsMock = vi.fn().mockResolvedValue([])
vi.mock('../../src/api_client', () => ({
    recordingApi: {
        listRecordings: (...args: unknown[]) => listRecordingsMock(...args),
        getRecordingFile: vi.fn().mockResolvedValue(null),
        deleteRecording: vi.fn().mockResolvedValue(undefined),
        getStorageEstimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1073741824 }),
    },
}))
vi.mock('../../src/sentry', () => ({
    sendException: vi.fn(),
    sendFeedback: vi.fn(),
    sendEvent: vi.fn(),
}))

// Override chrome mock to return 'ja' for @@ui_locale and use Japanese messages
const chromeMock = getChromeMock()
chromeMock.i18n.getMessage.mockImplementation((key: string, subs?: string | string[]) => {
    if (key === '@@ui_locale') return 'ja'
    return mockGetMessageJa(key, subs)
})

// Dynamic import AFTER mock is configured so uiLanguage evaluates as 'ja'
await import('../../src/element/recordList')

describe('record-list locale: ja', () => {
    beforeEach(() => {
        listRecordingsMock.mockReset().mockResolvedValue([])
    })

    test('Japanese pluralRules selects "other" for count=1 (no singular in Japanese)', async () => {
        // In Japanese, Intl.PluralRules always returns 'other' for any number,
        // so formatRecordCount(1) should use 'recordListRecordCountOther' → "1 件"
        listRecordingsMock.mockResolvedValue([
            {
                title: 'video-1000000000000.webm',
                path: 'video-1000000000000.webm',
                size: 1024,
                lastModified: Date.now(),
                mimeType: 'video/webm',
                recordedAt: 1000000000000,
                isTemporary: false,
                subFiles: [],
                subFilesSize: 0,
            },
        ])

        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            const heading = shadowQuery(el, '.storage-heading')
            // Japanese plural: count=1 → 'other' category → "1 件"
            expect(heading?.textContent).toContain('1 件')
        })
    })

    test('Japanese pluralRules selects "other" for count=0', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            const heading = shadowQuery(el, '.storage-heading')
            expect(heading?.textContent).toContain('0 件')
        })
    })

    test('Japanese pluralRules selects "other" for count=5', async () => {
        const recordings = Array.from({ length: 5 }, (_, i) => ({
            title: `video-${1000000000000 + i * 1000}.webm`,
            path: `video-${1000000000000 + i * 1000}.webm`,
            size: 512,
            lastModified: Date.now(),
            mimeType: 'video/webm',
            recordedAt: 1000000000000 + i * 1000,
            isTemporary: false,
            subFiles: [],
            subFilesSize: 0,
        }))
        listRecordingsMock.mockResolvedValue(recordings)

        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            const heading = shadowQuery(el, '.storage-heading')
            expect(heading?.textContent).toContain('5 件')
        })
    })
})
