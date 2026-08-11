import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { defineConfig, Plugin } from 'vite'
import { marked } from 'marked'

const docsDir = import.meta.dirname
const indexHtmlPath = path.resolve(docsDir, 'index.html')
const jaDir = path.resolve(docsDir, 'ja')
const jaIndexHtmlPath = path.resolve(jaDir, 'index.html')

const privacyMdFiles = {
    en: path.resolve(docsDir, 'PRIVACY.md'),
    ja: path.resolve(docsDir, 'PRIVACY_JA.md'),
}
const termsMdFiles = {
    en: path.resolve(docsDir, 'TERMS.md'),
    ja: path.resolve(docsDir, 'TERMS_JA.md'),
}
const privacyTemplate = path.resolve(docsDir, 'privacy.html')
const termsTemplate = path.resolve(docsDir, 'terms.html')

function loadLegalDocs() {
    return {
        privacyEn: marked.parse(readFileSync(privacyMdFiles.en, 'utf-8')) as string,
        privacyJa: marked.parse(readFileSync(privacyMdFiles.ja, 'utf-8')) as string,
        termsEn: marked.parse(readFileSync(termsMdFiles.en, 'utf-8')) as string,
        termsJa: marked.parse(readFileSync(termsMdFiles.ja, 'utf-8')) as string,
    }
}

const legalPages = [
    {
        fileName: 'PRIVACY.html',
        lang: 'en',
        title: 'Privacy Policy',
        contentKey: 'privacyEn' as const,
        template: privacyTemplate,
    },
    {
        fileName: 'PRIVACY_JA.html',
        lang: 'ja',
        title: 'プライバシーポリシー',
        contentKey: 'privacyJa' as const,
        template: privacyTemplate,
    },
    {
        fileName: 'TERMS.html',
        lang: 'en',
        title: 'Terms of Service',
        contentKey: 'termsEn' as const,
        template: termsTemplate,
    },
    {
        fileName: 'TERMS_JA.html',
        lang: 'ja',
        title: '利用規約',
        contentKey: 'termsJa' as const,
        template: termsTemplate,
    },
]

function renderLegalPage(templatePath: string, page: (typeof legalPages)[number], content: string): string {
    const templateHtml = readFileSync(templatePath, 'utf-8')
    return templateHtml
        .replace(/<%=\s*lang\s*%>/g, () => page.lang)
        .replace(/<%=\s*title\s*%>/g, () => page.title)
        .replace(/<%=\s*content\s*%>/g, () => content)
}

const PAGE_CONFIG = {
    en: {
        lang: 'en',
        title: 'Instant Tab Recorder - Blazingly simple tab recorder',
        description: 'Record any Chrome tab with just one click. Simple, fast, and privacy-focused.',
        canonicalUrl: 'https://recorder.appcloud.info/',
        basePath: './',
        logoHref: './',
        enLink: './',
        jaLink: './ja/',
        enActive: ' active',
        jaActive: '',
    },
    ja: {
        lang: 'ja',
        title: 'Instant Tab Recorder - シンプルで高速なタブ録画ツール',
        description: 'ワンクリックでChromeのタブを録画。シンプル、高速、そしてプライバシーに配慮。',
        canonicalUrl: 'https://recorder.appcloud.info/ja/',
        basePath: '../',
        logoHref: '../ja/',
        enLink: '../',
        jaLink: './',
        enActive: '',
        jaActive: ' active',
    },
}

function renderLpPage(templateHtml: string, lang: 'en' | 'ja'): string {
    const config = PAGE_CONFIG[lang]
    const vars = loadLegalDocs()

    // 1. Remove opposite language data-lang blocks
    const targetRemoveLang = lang === 'en' ? 'ja' : 'en'
    const removeRegex = new RegExp(`<\\w+[^>]*\\bdata-lang="${targetRemoveLang}"[^>]*>[\\s\\S]*?<\\/\\w+>`, 'gi')
    let result = templateHtml.replace(removeRegex, '')

    // 2. Clean up current language data-lang attribute
    result = result.replace(new RegExp(`\\s*data-lang="${lang}"`, 'g'), '')

    // 3. Render legal placeholders
    result = result
        .replace(/<%=\s*privacyEn\s*%>/g, () => vars.privacyEn)
        .replace(/<%=\s*privacyJa\s*%>/g, () => vars.privacyJa)
        .replace(/<%=\s*termsEn\s*%>/g, () => vars.termsEn)
        .replace(/<%=\s*termsJa\s*%>/g, () => vars.termsJa)

    // 4. Replace page configuration variables
    result = result.replace(/<%=\s*(\w+)\s*%>/g, (_, key) => {
        return config[key as keyof typeof config] ?? ''
    })

    return result
}

function buildLocalizedHtmlInput() {
    // Generate temporary ja/index.html so Vite natively outputs to dist/ja/index.html
    if (!existsSync(jaDir)) {
        mkdirSync(jaDir, { recursive: true })
    }
    const rawTemplate = readFileSync(indexHtmlPath, 'utf-8')
    writeFileSync(jaIndexHtmlPath, rawTemplate, 'utf-8')

    return {
        main: indexHtmlPath,
        ja: jaIndexHtmlPath,
    }
}

function docsPlugin(): Plugin[] {
    const buildPlugin: Plugin = {
        name: 'docs-build',
        apply: 'build',
        buildStart() {
            const vars = loadLegalDocs()

            for (const page of legalPages) {
                this.emitFile({
                    type: 'asset',
                    fileName: page.fileName,
                    source: renderLegalPage(page.template, page, vars[page.contentKey]),
                })
            }

            // Copy extension icon
            const iconData = readFileSync(path.resolve(docsDir, '..', 'extension/icons/icon128.png'))
            this.emitFile({ type: 'asset', fileName: 'icon128.png', source: iconData })
        },
        transformIndexHtml: {
            order: 'pre',
            handler(html, ctx) {
                const isJa = ctx?.filename?.includes('/ja/')
                return renderLpPage(html, isJa ? 'ja' : 'en')
            },
        },
        closeBundle() {
            // Clean up temporary ja source directory after build
            if (existsSync(jaDir)) {
                rmSync(jaDir, { recursive: true, force: true })
            }
        },
    }

    const servePlugin: Plugin = {
        name: 'docs-serve',
        apply: 'serve',
        transformIndexHtml: {
            order: 'pre',
            handler(html, ctx) {
                if (ctx?.filename?.includes('/ja/')) {
                    return renderLpPage(html, 'ja')
                }
                return renderLpPage(html, 'en')
            },
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                // Serve legal pages
                const match = legalPages.find(p => req.url === '/' + p.fileName)
                if (match) {
                    const vars = loadLegalDocs()
                    const html = renderLegalPage(match.template, match, vars[match.contentKey])
                    const injected = html.replace(
                        '</head>',
                        '  <script type="module" src="/@vite/client"></script>\n</head>',
                    )
                    res.setHeader('Content-Type', 'text/html')
                    res.end(injected)
                    return
                }
                // Serve extension icon
                if (req.url === '/icon128.png') {
                    const iconData = readFileSync(path.resolve(docsDir, '..', 'extension/icons/icon128.png'))
                    res.setHeader('Content-Type', 'image/png')
                    res.end(iconData)
                    return
                }
                next()
            })
            server.watcher.add([
                privacyMdFiles.en,
                privacyMdFiles.ja,
                termsMdFiles.en,
                termsMdFiles.ja,
                privacyTemplate,
                termsTemplate,
                indexHtmlPath,
            ])
            server.watcher.on('change', changedPath => {
                switch (changedPath) {
                    case privacyMdFiles.en:
                    case privacyMdFiles.ja:
                    case termsMdFiles.en:
                    case termsMdFiles.ja:
                    case privacyTemplate:
                    case termsTemplate:
                    case indexHtmlPath:
                        server.ws.send({ type: 'full-reload' })
                }
            })
        },
    }

    return [buildPlugin, servePlugin]
}

export default defineConfig({
    root: docsDir,
    input: buildLocalizedHtmlInput(),
    server: {
        port: 8080,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [docsPlugin()],
    base: './',
})
