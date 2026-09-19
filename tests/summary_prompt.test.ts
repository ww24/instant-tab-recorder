import { describe, it, expect } from 'vitest'
import { buildSummaryPrompt, DEFAULT_SUMMARY_PROMPT } from '../src/summary/prompt'

describe('buildSummaryPrompt', () => {
    const sampleText = 'テストの文字起こしデータです。会議の内容を記録しています。'

    it('generates prompt with default instructions and transcript', () => {
        const prompt = buildSummaryPrompt(sampleText)

        expect(prompt).toContain(DEFAULT_SUMMARY_PROMPT)
        expect(prompt).toContain('MANDATORY LANGUAGE RULE (HIGHEST PRIORITY):')
        expect(prompt).toContain('You MUST generate the final summary in the EXACT SAME LANGUAGE as the transcript.')
        expect(prompt).toContain(`## Input Transcript\n${sampleText}`)
    })

    it('uses custom instruction prompt when provided', () => {
        const customInstruction = 'Create a 3-bullet executive summary focusing on action items.'
        const prompt = buildSummaryPrompt(sampleText, customInstruction)
        expect(prompt).toContain(customInstruction)
        expect(prompt).not.toContain(DEFAULT_SUMMARY_PROMPT)
        expect(prompt).toContain(`## Input Transcript\n${sampleText}`)
    })

    it('falls back to DEFAULT_SUMMARY_PROMPT when customPrompt is empty or whitespace', () => {
        const promptEmpty = buildSummaryPrompt(sampleText, '')
        expect(promptEmpty).toContain(DEFAULT_SUMMARY_PROMPT)

        const promptWhitespace = buildSummaryPrompt(sampleText, '   ')
        expect(promptWhitespace).toContain(DEFAULT_SUMMARY_PROMPT)
    })
})
