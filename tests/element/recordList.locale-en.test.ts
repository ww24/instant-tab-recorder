import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getChromeMock } from './test-setup'
import { mockGetMessage } from '../i18n-mock'

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

// Override chrome mock to return 'en_US' for @@ui_locale BEFORE importing recordList
const chromeMock = getChromeMock()
chromeMock.i18n.getMessage.mockImplementation((key: string, subs?: string | string[]) => {
    if (key === '@@ui_locale') return 'en_US'
    return mockGetMessage(key, subs)
})

// Dynamic import AFTER mock is configured so uiLanguage evaluates as 'en'
await import('../../src/element/recordList')

describe('record-list locale: en_US', () => {
    beforeEach(() => {
        listRecordingsMock.mockReset().mockResolvedValue([])
    })

    test('English pluralRules selects "one" for count=1 (singular)', async () => {
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
            // English plural: count=1 → 'one' category → "1 Record" (singular)
            expect(heading?.textContent).toContain('1 Record')
            expect(heading?.textContent).not.toContain('1 Records')
        })
    })

    test('English pluralRules selects "other" for count=0 (plural)', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            const heading = shadowQuery(el, '.storage-heading')
            expect(heading?.textContent).toContain('0 Records')
        })
    })

    test('English pluralRules selects "other" for count=2+ (plural)', async () => {
        const recordings = Array.from({ length: 2 }, (_, i) => ({
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
            expect(heading?.textContent).toContain('2 Records')
        })
    })
})
