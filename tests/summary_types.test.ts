import { describe, it, expect } from 'vitest'
import { isSummaryResult, type SummaryResult } from '../src/summary/types'

describe('isSummaryResult', () => {
    const validResult: SummaryResult = {
        text: 'This is a valid summary.',
        summarizedAt: 1700000000000,
        modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
    }

    it('returns true for a valid SummaryResult object', () => {
        expect(isSummaryResult(validResult)).toBe(true)
    })

    it('returns true for an empty summary text', () => {
        expect(isSummaryResult({ ...validResult, text: '' })).toBe(true)
    })

    it('returns false for non-object and nullish values', () => {
        expect(isSummaryResult(null)).toBe(false)
        expect(isSummaryResult(undefined)).toBe(false)
        expect(isSummaryResult(123)).toBe(false)
        expect(isSummaryResult('string')).toBe(false)
        expect(isSummaryResult([])).toBe(false)
        expect(isSummaryResult(true)).toBe(false)
    })

    it('returns false when text is invalid', () => {
        expect(isSummaryResult({ ...validResult, text: undefined })).toBe(false)
        expect(isSummaryResult({ ...validResult, text: 123 })).toBe(false)
        expect(isSummaryResult({ ...validResult, text: null })).toBe(false)
    })

    it('returns false when summarizedAt is invalid', () => {
        expect(isSummaryResult({ ...validResult, summarizedAt: undefined })).toBe(false)
        expect(isSummaryResult({ ...validResult, summarizedAt: '1700000000000' })).toBe(false)
        expect(isSummaryResult({ ...validResult, summarizedAt: Number.NaN })).toBe(false)
        expect(isSummaryResult({ ...validResult, summarizedAt: Number.POSITIVE_INFINITY })).toBe(false)
        expect(isSummaryResult({ ...validResult, summarizedAt: -1 })).toBe(false)
    })

    it('returns false when modelId is invalid', () => {
        expect(isSummaryResult({ ...validResult, modelId: undefined })).toBe(false)
        expect(isSummaryResult({ ...validResult, modelId: 123 })).toBe(false)
        expect(isSummaryResult({ ...validResult, modelId: '' })).toBe(false)
        expect(isSummaryResult({ ...validResult, modelId: '   ' })).toBe(false)
    })
})
