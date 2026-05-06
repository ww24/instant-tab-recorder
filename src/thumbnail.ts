import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'

const DEFAULT_WIDTH = 480
const QUALITY = 0.8

export class NoVideoError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'NoVideoError'
    }
}

/**
 * Generate a WebP thumbnail from the first frame of a video blob.
 * Throws if thumbnail generation fails.
 */
export async function generateThumbnail(videoBlob: Blob, options?: { width?: number }): Promise<Blob> {
    using input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(videoBlob),
    })
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) throw new NoVideoError('failed to get video track')

    const firstTimestamp = await videoTrack.getFirstTimestamp()
    const sink = new VideoSampleSink(videoTrack)
    using sample = await sink.getSample(firstTimestamp)
    if (sample == null) throw new Error('failed to get video frame')

    const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth
    const width = options?.width ?? DEFAULT_WIDTH
    const height = Math.round(width * aspectRatio)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx == null) throw new Error('failed to get canvas 2d context')

    sample.drawWithFit(ctx, { fit: 'fill' })
    return await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY })
}
