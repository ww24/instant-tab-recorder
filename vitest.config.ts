import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
    optimizeDeps: {
        include: ['marked', 'lit/directives/unsafe-html.js'],
    },
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['lcov', 'text'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts'],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    include: ['tests/**/*.test.ts'],
                    exclude: ['tests/element/**/*.test.ts', 'tests/**/*.browser.test.ts'],
                    setupFiles: ['tests/test-setup.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'browser',
                    include: ['tests/element/**/*.test.ts'],
                    setupFiles: ['tests/element/test-setup.ts'],
                    browser: {
                        enabled: true,
                        provider: playwright(),
                        headless: true,
                        instances: [{ browser: 'chromium' }],
                    },
                },
            },
            {
                extends: true,
                test: {
                    name: 'browser-integration',
                    include: ['tests/**/*.browser.test.ts'],
                    browser: {
                        enabled: true,
                        provider: playwright(),
                        headless: true,
                        instances: [{ browser: 'chromium' }],
                    },
                },
            },
        ],
    },
})
