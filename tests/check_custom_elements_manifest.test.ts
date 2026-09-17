import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import {
    buildTagImportMapFromManifest,
    findMissingCustomElementImports,
    customElementsManifestCheckPlugin,
    loadManifestForPackage,
    type CustomElementsManifest,
} from '../scripts/check_custom_elements_manifest'

describe('Custom Elements Manifest (CEM) Import Checker', () => {
    describe('buildTagImportMapFromManifest', () => {
        it('extracts custom-element-definition exports from manifest', () => {
            const manifest: CustomElementsManifest = {
                schemaVersion: '1.0.0',
                modules: [
                    {
                        kind: 'javascript-module',
                        path: 'menu/menu-item.js',
                        exports: [
                            {
                                kind: 'custom-element-definition',
                                name: 'md-menu-item',
                            },
                        ],
                    },
                    {
                        kind: 'javascript-module',
                        path: 'button/filled-button.js',
                        declarations: [
                            {
                                kind: 'class',
                                name: 'MdFilledButton',
                                tagName: 'md-filled-button',
                            },
                        ],
                    },
                ],
            }

            const map = buildTagImportMapFromManifest(manifest, '@material/web')
            expect(map.get('md-menu-item')).toBe('@material/web/menu/menu-item')
            expect(map.get('md-filled-button')).toBe('@material/web/button/filled-button')
        })
    })

    describe('loadManifestForPackage', () => {
        it('successfully loads the real CEM of @material/web', () => {
            const manifest = loadManifestForPackage('@material/web')
            expect(manifest).toBeDefined()
            expect(manifest.modules.length).toBeGreaterThan(0)

            const map = buildTagImportMapFromManifest(manifest, '@material/web')
            expect(map.get('md-menu-item')).toBe('@material/web/menu/menu-item')
            expect(map.get('md-dialog')).toBe('@material/web/dialog/dialog')
            expect(map.get('md-tabs')).toBe('@material/web/tabs/tabs')
        })

        it('throws an error if package does not specify customElements field', () => {
            expect(() => loadManifestForPackage('vitest')).toThrow(/does not specify a "customElements" field/)
        })
    })

    describe('findMissingCustomElementImports', () => {
        const testTagMap = new Map([
            ['md-dialog', '@material/web/dialog/dialog'],
            ['md-menu-item', '@material/web/menu/menu-item'],
            ['md-filled-button', '@material/web/button/filled-button'],
        ])

        it('returns empty when no custom elements are present', () => {
            const code = `
                import '@material/web/button/text-button'
                console.log('hello world')
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.usedCustomElements).toEqual([])
            expect(result.missing).toEqual([])
        })

        it('detects missing imports for custom elements defined in CEM', () => {
            const code = `
                import '@material/web/dialog/dialog'
                const tpl = html\`
                    <md-dialog></md-dialog>
                    <md-menu-item></md-menu-item>
                    <md-filled-button></md-filled-button>
                \`
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.usedCustomElements).toContain('md-dialog')
            expect(result.usedCustomElements).toContain('md-menu-item')
            expect(result.usedCustomElements).toContain('md-filled-button')

            expect(result.missing).toEqual([
                { tagName: 'md-menu-item', expectedImport: '@material/web/menu/menu-item' },
                { tagName: 'md-filled-button', expectedImport: '@material/web/button/filled-button' },
            ])
        })

        it('ignores custom elements not in the CEM (e.g. local custom elements)', () => {
            const code = `
                const tpl = html\`<extension-player></extension-player>\`
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.usedCustomElements).toEqual(['extension-player'])
            expect(result.missing).toEqual([])
        })

        it('recognizes side-effect imports with or without extension', () => {
            const code1 = `
                import '@material/web/menu/menu-item'
                const tpl = html\`<md-menu-item></md-menu-item>\`
            `
            expect(findMissingCustomElementImports(code1, testTagMap).missing).toEqual([])

            const code2 = `
                import '@material/web/menu/menu-item.js'
                const tpl = html\`<md-menu-item></md-menu-item>\`
            `
            expect(findMissingCustomElementImports(code2, testTagMap).missing).toEqual([])
        })

        it('recognizes named value imports', () => {
            const code = `
                import { MdDialog } from '@material/web/dialog/dialog'
                const tpl = html\`<md-dialog></md-dialog>\`
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.missing).toEqual([])
        })

        it('ignores type-only imports because they do not register custom elements', () => {
            const code = `
                import type { MdDialog } from '@material/web/dialog/dialog'
                const tpl = html\`<md-dialog></md-dialog>\`
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.missing).toEqual([{ tagName: 'md-dialog', expectedImport: '@material/web/dialog/dialog' }])
        })

        it('does not flag elements inside comments', () => {
            const code = `
                // <md-dialog> in comment
                /* <md-menu-item> in block comment */
                <!-- <md-filled-button> in html comment -->
                const tpl = '<div>plain html</div>'
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.usedCustomElements).toEqual([])
            expect(result.missing).toEqual([])
        })

        it('does not count commented-out imports', () => {
            const code = `
                // import '@material/web/dialog/dialog'
                /* import '@material/web/menu/menu-item' */
                const tpl = html\`
                    <md-dialog></md-dialog>
                    <md-menu-item></md-menu-item>
                \`
            `
            const result = findMissingCustomElementImports(code, testTagMap)
            expect(result.missing).toEqual([
                { tagName: 'md-dialog', expectedImport: '@material/web/dialog/dialog' },
                { tagName: 'md-menu-item', expectedImport: '@material/web/menu/menu-item' },
            ])
        })
    })

    describe('customElementsManifestCheckPlugin', () => {
        const customManifest: CustomElementsManifest = {
            modules: [
                {
                    kind: 'javascript-module',
                    path: 'widget/fancy-box.js',
                    exports: [
                        {
                            kind: 'custom-element-definition',
                            name: 'fancy-box',
                        },
                    ],
                },
            ],
        }

        const plugin = customElementsManifestCheckPlugin({
            manifests: [
                {
                    packageName: '@my-lib',
                    manifest: customManifest,
                },
            ],
            packages: [],
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transform = (plugin as any).transform

        it('skips non-ts files or declaration files', () => {
            const ctx = { error: vi.fn() }
            expect(transform.call(ctx, '<fancy-box>', '/path/to/file.js')).toBeNull()
            expect(transform.call(ctx, '<fancy-box>', '/path/to/file.d.ts')).toBeNull()
            expect(transform.call(ctx, '<fancy-box>', '/node_modules/pkg/index.ts')).toBeNull()
            expect(transform.call(ctx, '<fancy-box>', '/Users/foo/tests/test.ts')).toBeNull()
            expect(ctx.error).not.toHaveBeenCalled()
        })

        it('passes without error when all imports are present in src ts files', () => {
            const ctx = { error: vi.fn() }
            const code = `
                import '@my-lib/widget/fancy-box'
                export const tpl = '<fancy-box></fancy-box>'
            `
            const result = transform.call(ctx, code, path.resolve('src/element/player.ts'))
            expect(result).toBeNull()
            expect(ctx.error).not.toHaveBeenCalled()
        })

        it('calls this.error when an import is missing in a src ts file', () => {
            const ctx = { error: vi.fn() }
            const code = `
                export const tpl = '<fancy-box></fancy-box>'
            `
            transform.call(ctx, code, path.resolve('src/element/player.ts'))
            expect(ctx.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Missing Custom Element component import(s) in src/element/player.ts: <fancy-box> (expected '@my-lib/widget/fancy-box')",
                ),
            )
        })
    })
})
