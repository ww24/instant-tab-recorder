import { readFileSync, writeFileSync } from 'fs'
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

export default defineConfig(({ mode }) => ({
    build: {
        outDir: 'extension/dist',
        emptyOutDir: true,
        rolldownOptions: {
            input: {
                offscreen: path.resolve(import.meta.dirname, 'src/offscreen.ts'),
                option: path.resolve(import.meta.dirname, 'src/option.ts'),
                service_worker: path.resolve(import.meta.dirname, 'src/service_worker.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: '[name]-[hash].js',
                codeSplitting: {
                    minSize: 20000,
                    groups: [
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
