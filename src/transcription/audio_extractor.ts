import {
    Input,
    Output,
    ALL_FORMATS,
    BlobSource,
    WavOutputFormat,
    BufferTarget,
    Conversion,
    AudioSampleSink,
} from 'mediabunny'

/**
 * Checks if a media file has at least one audio track using Mediabunny.
 */
export async function checkMediaHasAudio(file: Blob): Promise<boolean> {
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
    })

    const readable = await input.canRead()
    if (!readable) return false

    const audioTracks = await input.getAudioTracks()
    return audioTracks.length > 0
}

/**
 * Streaming linear interpolation audio resampler.
 * Accurately handles chunk boundaries with continuous fractional phase.
 */
export class StreamResampler {
    private phase = 0 // Position in source samples relative to the start of current input chunk
    private hasPrev = false
    private prevSample = 0
    private readonly ratio: number

    constructor(
        private readonly sourceRate: number,
        private readonly targetRate = 16000,
    ) {
        this.ratio = sourceRate / targetRate
    }

    process(input: Float32Array): Float32Array {
        if (this.sourceRate === this.targetRate) {
            return input
        }
        if (input.length === 0) {
            return new Float32Array(0)
        }

        const out: number[] = []
        let pos = this.phase

        while (pos < input.length) {
            const idx = Math.floor(pos)
            const frac = pos - idx
            let s0: number
            let s1: number

            if (idx < 0) {
                s0 = this.hasPrev ? this.prevSample : input[0]
                s1 = input[0]
            } else if (idx < input.length - 1) {
                s0 = input[idx]
                s1 = input[idx + 1]
            } else {
                // idx === input.length - 1: s1 is in the next chunk
                break
            }

            out.push(s0 + frac * (s1 - s0))
            pos += this.ratio
        }

        this.hasPrev = true
        this.prevSample = input[input.length - 1]
        this.phase = pos - input.length

        return new Float32Array(out)
    }

    flush(): Float32Array {
        if (this.sourceRate === this.targetRate || !this.hasPrev) {
            return new Float32Array(0)
        }
        const out: number[] = []
        let pos = this.phase
        while (pos <= 0) {
            out.push(this.prevSample)
            pos += this.ratio
        }
        this.hasPrev = false
        this.phase = 0
        return new Float32Array(out)
    }
}

export interface ExtractAudioStreamOptions {
    /** Target chunk size in samples (at 16kHz). Default is 16000 (1.0s). */
    chunkSize?: number
    onProgress?: (progress: number) => void
}

/**
 * Streams 16kHz mono Float32Array PCM chunks from a media file using Mediabunny's AudioSampleSink.
 * Memory consumption is bounded to O(1) regardless of video duration.
 * @yields {Float32Array} 16kHz mono PCM chunk
 */
export async function* extractAudioStream(
    file: Blob,
    options: ExtractAudioStreamOptions = {},
): AsyncGenerator<Float32Array, void, unknown> {
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
    })

    const readable = await input.canRead()
    if (!readable) {
        throw new Error('Unsupported or corrupted media file.')
    }

    const audioTracks = await input.getAudioTracks()
    if (audioTracks.length === 0) {
        throw new Error('No audio track found in media file.')
    }

    const track = audioTracks[0]
    const sampleRate = await track.getSampleRate()
    const numberOfChannels = await track.getNumberOfChannels()
    if (!sampleRate || !numberOfChannels) {
        throw new Error('Unable to determine audio track parameters (sample rate or channels).')
    }

    let totalDuration = await track.getDurationFromMetadata()
    if (totalDuration == null || totalDuration <= 0) {
        try {
            totalDuration = await track.computeDuration()
        } catch {
            totalDuration = null
        }
    }

    const sink = new AudioSampleSink(track)
    const resampler = new StreamResampler(sampleRate, 16000)
    const chunkSize = options.chunkSize ?? 16000

    let accumulator = new Float32Array(chunkSize * 2)
    let accumulatorLength = 0
    let tempChannelBuffer = new Float32Array(0)

    for await (const sample of sink.samples()) {
        try {
            const numFrames = sample.numberOfFrames
            const numCh = sample.numberOfChannels

            // Extract channel 0 into mono buffer
            const mono = new Float32Array(numFrames)
            sample.copyTo(mono, { planeIndex: 0, format: 'f32-planar' })

            // Downmix additional channels to mono if multichannel
            if (numCh > 1) {
                if (tempChannelBuffer.length < numFrames) {
                    tempChannelBuffer = new Float32Array(numFrames)
                }
                const chSlice = tempChannelBuffer.subarray(0, numFrames)
                for (let ch = 1; ch < numCh; ch++) {
                    sample.copyTo(chSlice, { planeIndex: ch, format: 'f32-planar' })
                    for (let i = 0; i < numFrames; i++) {
                        mono[i] += chSlice[i]
                    }
                }
                const inv = 1 / numCh
                for (let i = 0; i < numFrames; i++) {
                    mono[i] *= inv
                }
            }

            // Resample to 16kHz
            const resampled = resampler.process(mono)

            if (resampled.length > 0) {
                if (accumulatorLength + resampled.length > accumulator.length) {
                    const newCap = Math.max(accumulator.length * 2, accumulatorLength + resampled.length + chunkSize)
                    const newBuf = new Float32Array(newCap)
                    newBuf.set(accumulator.subarray(0, accumulatorLength))
                    accumulator = newBuf
                }
                accumulator.set(resampled, accumulatorLength)
                accumulatorLength += resampled.length

                while (accumulatorLength >= chunkSize) {
                    const chunk = accumulator.slice(0, chunkSize)
                    accumulator.copyWithin(0, chunkSize, accumulatorLength)
                    accumulatorLength -= chunkSize
                    yield chunk
                }
            }

            if (options.onProgress && totalDuration && totalDuration > 0) {
                const currentSec = sample.timestamp + sample.duration
                const progress = Math.min(Math.max(currentSec / totalDuration, 0), 1)
                options.onProgress(progress)
            }
        } finally {
            sample.close()
        }
    }

    // Flush any remaining resampler data
    const finalSamples = resampler.flush()
    if (finalSamples.length > 0) {
        if (accumulatorLength + finalSamples.length > accumulator.length) {
            const newBuf = new Float32Array(accumulatorLength + finalSamples.length)
            newBuf.set(accumulator.subarray(0, accumulatorLength))
            accumulator = newBuf
        }
        accumulator.set(finalSamples, accumulatorLength)
        accumulatorLength += finalSamples.length
    }

    while (accumulatorLength > 0) {
        const size = Math.min(accumulatorLength, chunkSize)
        const chunk = accumulator.slice(0, size)
        accumulator.copyWithin(0, size, accumulatorLength)
        accumulatorLength -= size
        yield chunk
    }

    if (options.onProgress) {
        options.onProgress(1)
    }
}

/**
 * Converts a 16-bit / 32-bit PCM WAV buffer to a Float32Array (-1.0 to 1.0).
 */
export function wavToFloat32Array(buffer: ArrayBuffer): Float32Array {
    const dataView = new DataView(buffer)
    const riff = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2),
        dataView.getUint8(3),
    )
    if (riff !== 'RIFF') {
        throw new Error('Invalid WAV file header.')
    }

    let offset = 12
    let audioFormat = 1
    let bitsPerSample = 16
    let dataOffset = 0
    let dataLength = 0

    while (offset + 8 <= buffer.byteLength) {
        const chunkId = String.fromCharCode(
            dataView.getUint8(offset),
            dataView.getUint8(offset + 1),
            dataView.getUint8(offset + 2),
            dataView.getUint8(offset + 3),
        )
        const chunkSize = dataView.getUint32(offset + 4, true)

        if (chunkId === 'fmt ') {
            audioFormat = dataView.getUint16(offset + 8, true)
            bitsPerSample = dataView.getUint16(offset + 22, true)
        } else if (chunkId === 'data') {
            dataOffset = offset + 8
            dataLength = chunkSize
            break
        }
        offset += 8 + chunkSize
    }

    if (dataOffset === 0 || dataOffset + dataLength > buffer.byteLength) {
        dataLength = buffer.byteLength - dataOffset
    }

    if (audioFormat === 3) {
        // 32-bit IEEE float
        return new Float32Array(buffer.slice(dataOffset, dataOffset + dataLength))
    } else if (audioFormat === 1) {
        // 16-bit PCM integer
        if (bitsPerSample === 16) {
            const int16 = new Int16Array(buffer, dataOffset, Math.floor(dataLength / 2))
            const float32 = new Float32Array(int16.length)
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768.0
            }
            return float32
        } else if (bitsPerSample === 32) {
            const int32 = new Int32Array(buffer, dataOffset, Math.floor(dataLength / 4))
            const float32 = new Float32Array(int32.length)
            for (let i = 0; i < int32.length; i++) {
                float32[i] = int32[i] / 2147483648.0
            }
            return float32
        }
    }

    throw new Error(`Unsupported WAV audio format: format=${audioFormat}, bits=${bitsPerSample}`)
}

/**
 * Extracts the audio track from a media file and resamples it to 16kHz mono Float32Array PCM.
 */
export async function extractAudioPCM(file: Blob, onProgress?: (progress: number) => void): Promise<Float32Array> {
    try {
        const chunks: Float32Array[] = []
        let totalLen = 0
        for await (const chunk of extractAudioStream(file, { onProgress })) {
            chunks.push(chunk)
            totalLen += chunk.length
        }
        const result = new Float32Array(totalLen)
        let offset = 0
        for (const chunk of chunks) {
            result.set(chunk, offset)
            offset += chunk.length
        }
        return result
    } catch {
        // Fallback to Conversion with WavOutputFormat if AudioSampleSink / WebCodecs fails (e.g. mock/test environments)
        const input = new Input({
            formats: ALL_FORMATS,
            source: new BlobSource(file),
        })

        const readable = await input.canRead()
        if (!readable) {
            throw new Error('Unsupported or corrupted media file.')
        }

        const audioTracks = await input.getAudioTracks()
        if (audioTracks.length === 0) {
            throw new Error('No audio track found in media file.')
        }

        const target = new BufferTarget()
        const output = new Output({
            format: new WavOutputFormat(),
            target,
        })

        const conversion = await Conversion.init({
            input,
            output,
            tracks: 'primary',
            video: {
                discard: true, // Extract only audio
            },
            audio: {
                numberOfChannels: 1, // Mono
                sampleRate: 16000, // 16kHz for Whisper
                sampleFormat: 's16', // 16-bit PCM WAV
            },
            showWarnings: false,
        })

        if (!conversion.isValid) {
            const reasons = conversion.discardedTracks.map(t => t.reason).join(', ')
            throw new Error(`Audio extraction conversion failed: ${reasons}`)
        }

        if (onProgress) {
            conversion.onProgress = progress => {
                onProgress(Math.min(Math.max(progress, 0), 1))
            }
        }

        await conversion.execute()

        const buffer = target.buffer
        if (!buffer) {
            throw new Error('Failed to retrieve converted audio buffer from Mediabunny.')
        }

        return wavToFloat32Array(buffer)
    }
}
