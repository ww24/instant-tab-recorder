import { errorToString } from '../src/error'

describe('errorToString', () => {
    it('returns stringified non-Error values', () => {
        expect(errorToString('plain error')).toBe('plain error')
    })

    it('removes chrome extension URLs from the stack trace', () => {
        const error = new Error('boom')
        error.stack = [
            'Error: boom',
            '    at start (chrome-extension://abcdefghijklmnop/src/offscreen.ts:10:5)',
            '    at next (chrome-extension://ponmlkjihgfedcba/src/other.ts:20:8)',
        ].join('\n')

        expect(errorToString(error)).toBe(
            ['Error: boom', '    at start (src/offscreen.ts:10:5)', '    at next (src/other.ts:20:8)'].join('\n'),
        )
    })

    it('includes nested causes recursively', () => {
        const rootCause = new Error('root cause')
        rootCause.stack = 'Error: root cause\n    at leaf (src/leaf.ts:3:1)'

        const error = new Error('top level', { cause: rootCause })
        error.stack = 'Error: top level\n    at main (src/main.ts:1:1)'

        expect(errorToString(error)).toBe(
            [
                'Error: top level',
                '    at main (src/main.ts:1:1)',
                'Caused by: Error: root cause',
                '    at leaf (src/leaf.ts:3:1)',
            ].join('\n'),
        )
    })
})
