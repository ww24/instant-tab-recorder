import type { Resolution, VideoRecordingMode, Microphone } from '../configuration'
import { hasVideo, hasAudio } from '../configuration'

export interface MediaDevicesProvider {
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
}

export class MediaCapture {
    constructor(private readonly devices: MediaDevicesProvider) {}

    /**
     * Capture tab media (video and/or audio) based on recording mode.
     */
    async captureTab(
        streamId: string,
        recordingSize: Resolution,
        frameRate: number,
        recordingMode: VideoRecordingMode,
        audioSampleRate: number,
    ): Promise<MediaStream> {
        return this.devices.getUserMedia({
            audio: hasAudio(recordingMode)
                ? {
                      mandatory: {
                          chromeMediaSource: 'tab',
                          chromeMediaSourceId: streamId,
                          maxSampleRate: audioSampleRate,
                      },
                  }
                : undefined,
            video: hasVideo(recordingMode)
                ? {
                      mandatory: {
                          chromeMediaSource: 'tab',
                          chromeMediaSourceId: streamId,
                          maxWidth: recordingSize.width,
                          maxHeight: recordingSize.height,
                          maxFrameRate: frameRate,
                      },
                  }
                : undefined,
        })
    }

    /**
     * Capture microphone audio if enabled.
     * Returns null if microphone is disabled or access is denied.
     */
    async captureMicrophone(microphone: Microphone, audioSampleRate: number): Promise<MediaStream | null> {
        if (!microphone.enabled) return null

        try {
            return await this.devices.getUserMedia({
                audio: {
                    echoCancellation: microphone.echoCancellation ?? true,
                    noiseSuppression: microphone.noiseSuppression ?? true,
                    autoGainControl: microphone.autoGainControl ?? false,
                    sampleRate: audioSampleRate,
                    ...(microphone.deviceId && microphone.deviceId !== 'default'
                        ? { deviceId: { exact: microphone.deviceId } }
                        : {}),
                },
            })
        } catch (e) {
            console.warn('Microphone access denied:', e)
            return null
        }
    }
}
