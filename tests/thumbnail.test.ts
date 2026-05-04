import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetPrimaryVideoTrack = vi.fn()
const mockGetFirstTimestamp = vi.fn()
const mockGetSample = vi.fn()
const mockInputDispose = vi.fn()
const mockDrawWithFit = vi.fn()
const mockConvertToBlob = vi.fn()
const mockGetContext = vi.fn()
const mockOffscreenCanvasConstructor = vi.fn()

vi.mock('mediabunny', () => {
    return {
        ALL_FORMATS: ['webm', 'mp4'],
        BlobSource: class MockBlobSource {},
        Input: class MockInput {
            getPrimaryVideoTrack = mockGetPrimaryVideoTrack;
            [Symbol.dispose] = mockInputDispose
        },
        VideoSampleSink: class MockVideoSampleSink {
            getSample = mockGetSample
        },
    }
})

import { generateThumbnail } from '../src/thumbnail'

function createFakeSample() {
    return {
        [Symbol.dispose]: vi.fn(),
        drawWithFit: mockDrawWithFit,
    }
}

describe('generateThumbnail', () => {
    beforeEach(() => {
        mockGetPrimaryVideoTrack.mockReset()
        mockGetFirstTimestamp.mockReset()
        mockGetSample.mockReset()
        mockInputDispose.mockReset()
        mockDrawWithFit.mockReset()
        mockConvertToBlob.mockReset()
        mockGetContext.mockReset()
        mockOffscreenCanvasConstructor.mockReset()

        mockGetContext.mockReturnValue({})

        vi.stubGlobal(
            'OffscreenCanvas',
            class MockOffscreenCanvas {
                getContext = mockGetContext
                convertToBlob = mockConvertToBlob
                constructor(width: number, height: number) {
                    mockOffscreenCanvasConstructor(width, height)
                }
            },
        )
    })

    it('generates a WebP thumbnail from the first frame', async () => {
        const fakeBlob = new Blob(['webp-data'], { type: 'image/webp' })
        mockGetPrimaryVideoTrack.mockResolvedValue({
            displayWidth: 1920,
            displayHeight: 1080,
            getFirstTimestamp: mockGetFirstTimestamp,
        })
        mockGetFirstTimestamp.mockResolvedValue(0.5)
        mockGetSample.mockResolvedValue(createFakeSample())
        mockConvertToBlob.mockResolvedValue(fakeBlob)

        const videoBlob = new Blob(['video'], { type: 'video/webm' })
        const result = await generateThumbnail(videoBlob)

        expect(result).toBe(fakeBlob)
        expect(mockGetSample).toHaveBeenCalledWith(0.5)
        expect(mockOffscreenCanvasConstructor).toHaveBeenCalledWith(480, 270)
        expect(mockConvertToBlob).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.8 })
        expect(mockInputDispose).toHaveBeenCalled()
    })

    it('uses custom width and calculates height from aspect ratio', async () => {
        mockGetPrimaryVideoTrack.mockResolvedValue({
            displayWidth: 1280,
            displayHeight: 720,
            getFirstTimestamp: mockGetFirstTimestamp,
        })
        mockGetFirstTimestamp.mockResolvedValue(0)
        mockGetSample.mockResolvedValue(createFakeSample())
        mockConvertToBlob.mockResolvedValue(new Blob())

        await generateThumbnail(new Blob(), { width: 160 })

        expect(mockOffscreenCanvasConstructor).toHaveBeenCalledWith(160, 90)
    })

    it('throws when no video track found', async () => {
        mockGetPrimaryVideoTrack.mockResolvedValue(null)

        await expect(generateThumbnail(new Blob())).rejects.toThrow('failed to get video track')
        expect(mockInputDispose).toHaveBeenCalled()
    })

    it('throws when getPrimaryVideoTrack rejects', async () => {
        mockGetPrimaryVideoTrack.mockRejectedValue(new Error('decode error'))

        await expect(generateThumbnail(new Blob())).rejects.toThrow('decode error')
        expect(mockInputDispose).toHaveBeenCalled()
    })

    it('throws when getSample rejects', async () => {
        mockGetPrimaryVideoTrack.mockResolvedValue({
            displayWidth: 1920,
            displayHeight: 1080,
            getFirstTimestamp: mockGetFirstTimestamp,
        })
        mockGetFirstTimestamp.mockResolvedValue(0)
        mockGetSample.mockRejectedValue(new Error('sample error'))

        await expect(generateThumbnail(new Blob())).rejects.toThrow('sample error')
        expect(mockInputDispose).toHaveBeenCalled()
    })

    it('throws when getSample returns null', async () => {
        mockGetPrimaryVideoTrack.mockResolvedValue({
            displayWidth: 1920,
            displayHeight: 1080,
            getFirstTimestamp: mockGetFirstTimestamp,
        })
        mockGetFirstTimestamp.mockResolvedValue(0)
        mockGetSample.mockResolvedValue(null)

        await expect(generateThumbnail(new Blob())).rejects.toThrow('failed to get video frame')
        expect(mockInputDispose).toHaveBeenCalled()
    })

    it('throws when getFirstTimestamp rejects', async () => {
        mockGetPrimaryVideoTrack.mockResolvedValue({
            displayWidth: 1920,
            displayHeight: 1080,
            getFirstTimestamp: vi.fn().mockRejectedValue(new Error('timestamp error')),
        })

        await expect(generateThumbnail(new Blob())).rejects.toThrow('timestamp error')
        expect(mockInputDispose).toHaveBeenCalled()
    })
})
