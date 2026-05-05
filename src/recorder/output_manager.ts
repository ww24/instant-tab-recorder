import { Output, StreamTarget, MediaStreamVideoTrackSource, MediaStreamAudioTrackSource } from 'mediabunny'
import type { VideoFormat } from '../configuration'
import { createOutputFormat, resolveBitrate, hasVideo } from '../configuration'

export type PausableSource = MediaStreamVideoTrackSource | MediaStreamAudioTrackSource

export interface OutputHandle {
    output: Output
    sources: PausableSource[]
    errorPromises: Promise<void>[]
}

export class OutputManager {
    /**
     * Create a mediabunny Output writing to the given WritableStream.
     */
    createOutput(writableStream: WritableStream, container: VideoFormat['container']): Output {
        return new Output({
            format: createOutputFormat(container),
            target: new StreamTarget(writableStream, { chunked: true }),
        })
    }

    /**
     * Add video and/or audio tracks to the output based on recording mode.
     * Returns an array of error promises and an array of pausable sources.
     */
    addTracks(
        output: Output,
        media: MediaStream,
        videoFormat: VideoFormat,
        hasAudioTrack: boolean,
    ): { sources: PausableSource[]; errorPromises: Promise<void>[] } {
        const sources: PausableSource[] = []
        const errorPromises: Promise<void>[] = []

        // Add video track
        if (hasVideo(videoFormat.recordingMode)) {
            const mediaVideoTrack = media.getVideoTracks()[0] as MediaStreamVideoTrack | undefined
            if (mediaVideoTrack) {
                const videoSource = new MediaStreamVideoTrackSource(mediaVideoTrack, {
                    codec: videoFormat.videoCodec,
                    bitrate: resolveBitrate(videoFormat.videoBitratePreset, videoFormat.videoBitrate),
                    sizeChangeBehavior: 'passThrough',
                })
                output.addVideoTrack(videoSource)
                sources.push(videoSource)
                errorPromises.push(
                    videoSource.errorPromise.catch(e => {
                        throw new Error('Video source error', { cause: e })
                    }),
                )
            }
        }

        // Add audio track
        if (hasAudioTrack) {
            const mediaAudioTrack = media.getAudioTracks()[0] as MediaStreamAudioTrack | undefined
            if (mediaAudioTrack) {
                const audioSource = new MediaStreamAudioTrackSource(mediaAudioTrack, {
                    codec: videoFormat.audioCodec,
                    bitrate: resolveBitrate(videoFormat.audioBitratePreset, videoFormat.audioBitrate),
                })
                output.addAudioTrack(audioSource)
                sources.push(audioSource)
                errorPromises.push(
                    audioSource.errorPromise.catch(e => {
                        throw new Error('Audio source error', { cause: e })
                    }),
                )
            }
        }

        return { sources, errorPromises }
    }

    /**
     * Create an audio-only output for a single audio track (used for audio separation).
     */
    createAudioTrackOutput(
        writableStream: WritableStream,
        audioTrack: MediaStreamAudioTrack,
        container: VideoFormat['container'],
        audioCodec: VideoFormat['audioCodec'],
        audioBitratePreset: VideoFormat['audioBitratePreset'],
        audioBitrate: VideoFormat['audioBitrate'],
    ): OutputHandle {
        const output = this.createOutput(writableStream, container)
        const audioSource = new MediaStreamAudioTrackSource(audioTrack, {
            codec: audioCodec,
            bitrate: resolveBitrate(audioBitratePreset, audioBitrate),
        })
        output.addAudioTrack(audioSource)
        return {
            output,
            sources: [audioSource],
            errorPromises: [
                audioSource.errorPromise.catch(e => {
                    throw new Error('Audio separation source error', { cause: e })
                }),
            ],
        }
    }
}
