import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs'
import path from 'path'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'))
const manifestPath = path.resolve(import.meta.dirname, 'extension/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

if (manifest.version !== pkg.version) {
    manifest.version = pkg.version
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n')
    console.log(`Updated manifest.json version to ${pkg.version}`)
}

const envName = process.env.ENV_NAME === 'production' ? 'production' : 'develop'
console.log(`${envName} build`)

const sentryDSN = process.env.SENTRY_DSN
if (!sentryDSN) {
    console.warn('WARNING: SENTRY_DSN environment variable is not set. Sentry error reporting will be disabled.')
}

function appendModelLicensesPlugin() {
    return {
        name: 'append-model-licenses',
        closeBundle() {
            const licensePath = path.resolve(import.meta.dirname, 'extension/dist/dependencies-licenses.md')
            if (!existsSync(licensePath)) return

            const modelLicensePath = path.resolve(import.meta.dirname, 'MODEL_LICENSES.md')
            if (!existsSync(modelLicensePath)) return

            const modelLicenseText = readFileSync(modelLicensePath, 'utf-8')
            const content = readFileSync(licensePath, 'utf-8')
            if (!content.includes('Silero VAD - v6.2')) {
                appendFileSync(licensePath, '\n' + modelLicenseText.trim() + '\n')
            }
        },
    }
}

export default defineConfig(({ mode }) => ({
    base: '/dist/',
    plugins: [appendModelLicensesPlugin()],
    optimizeDeps: {
        exclude: ['@huggingface/transformers', 'mediabunny'],
    },
    build: {
        outDir: 'extension/dist',
        emptyOutDir: true,
        modulePreload: false,
        rolldownOptions: {
            input: {
                offscreen: path.resolve(import.meta.dirname, 'src/offscreen.ts'),
                option: path.resolve(import.meta.dirname, 'src/option.ts'),
                service_worker: path.resolve(import.meta.dirname, 'src/service_worker.ts'),
                player: path.resolve(import.meta.dirname, 'src/player.ts'),
                transcription_worker: path.resolve(import.meta.dirname, 'src/transcription/worker.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: '[name]-[hash].js',
                banner: `if (typeof self !== 'undefined') {
    const g = self;
    if (typeof g.window === 'undefined') g.window = g;
    if (typeof g.document === 'undefined') {
        g.document = {
            createElement: () => ({ setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, relList: { supports: () => false } }),
            getElementsByTagName: () => [],
            querySelector: () => null,
            head: { appendChild: () => {}, removeChild: () => {} },
        };
    }
}`,
                codeSplitting: {
                    minSize: 20000,
                    groups: [
                        {
                            name: 'vendor-transformers',
                            test: /node_modules[\\/]@huggingface[\\/]transformers/,
                            priority: 30,
                        },
                        {
                            name: 'vendor-mediabunny',
                            test: /node_modules[\\/]mediabunny/,
                            priority: 20,
                        },
                        {
                            name: 'vendor-mediabunny-flac-encoder',
                            test: /node_modules[\\/]@mediabunny[\\/]flac-encoder/,
                            priority: 10,
                        },
                    ],
                },
            },
        },
        sourcemap: !!process.env.SOURCEMAP,
        minify: mode === 'production',
        target: 'chrome140',
        license: { fileName: 'dependencies-licenses.md' },
    },
    define: {
        'process.env.PKG_NAME': JSON.stringify(pkg.name),
        'process.env.VERSION': JSON.stringify(pkg.version),
        'process.env.ENV_NAME': JSON.stringify(envName),
        'process.env.SENTRY_DSN': JSON.stringify(sentryDSN),
    },
}))
