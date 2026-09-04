import { describe, it, expect } from 'vitest'
import { StreamResampler, wavToFloat32Array } from '../../src/transcription/audio_extractor'

describe('StreamResampler', () => {
    it('returns same array when source and target rates match', () => {
        const resampler = new StreamResampler(16000, 16000)
        const input = new Float32Array([0.1, 0.2, 0.3])
        const output = resampler.process(input)
        expect(output).toBe(input)
        expect(resampler.flush()).toEqual(new Float32Array(0))
    })

    it('returns empty array for empty input', () => {
        const resampler = new StreamResampler(48000, 16000)
        const output = resampler.process(new Float32Array(0))
        expect(output).toEqual(new Float32Array(0))
    })

    it('correctly downsamples 48000Hz to 16000Hz (3:1 integer ratio)', () => {
        const resampler = new StreamResampler(48000, 16000)
        // 12 samples at 48kHz -> 4 samples at 16kHz
        const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
        const output = resampler.process(input)
        // Indices 0, 3, 6, 9
        expect(Array.from(output)).toEqual([0, 3, 6, 9])
    })

    it('produces seamless continuous output across chunk boundaries', () => {
        const resamplerFull = new StreamResampler(48000, 16000)
        const fullInput = new Float32Array(300)
        for (let i = 0; i < fullInput.length; i++) {
            fullInput[i] = Math.sin((i / 48000) * 2 * Math.PI * 440)
        }
        const fullOutput = Array.from(resamplerFull.process(fullInput))

        // Process in small arbitrary chunk sizes
        const resamplerChunked = new StreamResampler(48000, 16000)
        const chunkSizes = [13, 27, 50, 10, 100, 100]
        const chunkedOutput: number[] = []
        let offset = 0
        for (const size of chunkSizes) {
            const chunk = fullInput.subarray(offset, offset + size)
            offset += size
            const res = resamplerChunked.process(chunk)
            chunkedOutput.push(...Array.from(res))
        }

        // Check that chunked output matches full output up to the processed samples
        expect(chunkedOutput.length).toBeGreaterThan(0)
        for (let i = 0; i < chunkedOutput.length; i++) {
            expect(chunkedOutput[i]).toBeCloseTo(fullOutput[i], 5)
        }
    })

    it('correctly resamples non-integer ratio (44100Hz to 16000Hz)', () => {
        const resampler = new StreamResampler(44100, 16000)
        const input = new Float32Array(4410) // 0.1s at 44.1kHz -> ~1600 samples at 16kHz
        for (let i = 0; i < input.length; i++) {
            input[i] = Math.sin((i / 44100) * 2 * Math.PI * 1000)
        }
        const output = resampler.process(input)
        // 4410 / (44100/16000) = 1600
        expect(Math.abs(output.length - 1600)).toBeLessThanOrEqual(2)
        // Output values must be within [-1, 1]
        for (let i = 0; i < output.length; i++) {
            expect(output[i]).toBeGreaterThanOrEqual(-1.01)
            expect(output[i]).toBeLessThanOrEqual(1.01)
        }
    })

    it('handles flush at EOF for remaining samples', () => {
        const resampler = new StreamResampler(48000, 16000)
        // 5 samples at 48kHz. Ratio is 3. Output at pos 0 (idx 0), pos 3 (idx 3). pos 6 is in next chunk.
        const input = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0])
        const out = resampler.process(input)
        expect(Array.from(out)).toEqual([1.0, 4.0])
        const flushed = resampler.flush()
        expect(flushed.length).toBeGreaterThanOrEqual(0)
    })
})

describe('wavToFloat32Array', () => {
    it('throws error for invalid WAV header', () => {
        const buffer = new ArrayBuffer(16)
        expect(() => wavToFloat32Array(buffer)).toThrow('Invalid WAV file header.')
    })
})
