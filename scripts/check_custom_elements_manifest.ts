import { readFileSync } from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { parseAst, type Plugin } from 'vite'

export interface CustomElementManifestModuleExport {
    kind: string
    name: string
    declaration?: {
        name?: string
        module?: string
        package?: string
    }
}

export interface CustomElementManifestDeclaration {
    kind: string
    name: string
    tagName?: string
    customElement?: boolean
}

export interface CustomElementManifestModule {
    kind: string
    path: string
    declarations?: CustomElementManifestDeclaration[]
    exports?: CustomElementManifestModuleExport[]
}

/**
 * Partial representation of Custom Elements Manifest (CEM) schema.
 * @see https://github.com/webcomponents/custom-elements-manifest
 */
export interface CustomElementsManifest {
    schemaVersion?: string
    modules: CustomElementManifestModule[]
}

export interface MissingImport {
    tagName: string
    expectedImport: string
}

export interface CheckImportsResult {
    usedCustomElements: string[]
    missing: MissingImport[]
}

/**
 * Builds a mapping from Custom Element tagName to its expected module import path
 * using the Custom Elements Manifest (CEM).
 */
export function buildTagImportMapFromManifest(
    manifest: CustomElementsManifest,
    packageName: string,
): Map<string, string> {
    const tagMap = new Map<string, string>()

    for (const mod of manifest.modules || []) {
        // Strip file extension (e.g. "menu/menu-item.js" -> "menu/menu-item")
        const subpath = mod.path.replace(/\.[a-zA-Z0-9]+$/, '')
        const importPath = `${packageName}/${subpath}`

        // 1. Check exports for kind: "custom-element-definition"
        for (const exp of mod.exports || []) {
            if (exp.kind === 'custom-element-definition' && exp.name) {
                tagMap.set(exp.name, importPath)
            }
        }

        // 2. Fallback: check declarations for tagName
        for (const decl of mod.declarations || []) {
            if (decl.tagName && !tagMap.has(decl.tagName)) {
                tagMap.set(decl.tagName, importPath)
            }
        }
    }

    return tagMap
}

/**
 * Loads the Custom Elements Manifest for a package by resolving its package.json
 * and following the "customElements" field defined by the CEM ecosystem standard.
 */
export function loadManifestForPackage(packageName: string, baseDir = process.cwd()): CustomElementsManifest {
    const req = createRequire(path.join(baseDir, 'package.json'))
    const pkgJsonPath = req.resolve(`${packageName}/package.json`)
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))

    if (!pkg.customElements) {
        throw new Error(`Package "${packageName}" does not specify a "customElements" field in package.json`)
    }

    const manifestPath = path.resolve(path.dirname(pkgJsonPath), pkg.customElements)
    const manifestContent = readFileSync(manifestPath, 'utf-8')
    return JSON.parse(manifestContent) as CustomElementsManifest
}

/**
 * Recursively walks an ESTree AST node.
 */
function walkAst(node: unknown, visitor: (node: Record<string, unknown>) => void) {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    visitor(record)
    for (const key of Object.keys(record)) {
        if (key === 'loc' || key === 'range') continue
        const child = record[key]
        if (Array.isArray(child)) {
            for (const c of child) {
                walkAst(c, visitor)
            }
        } else if (child && typeof child === 'object') {
            walkAst(child, visitor)
        }
    }
}

/**
 * Extracts custom element tags from text, ignoring HTML comments.
 */
function extractCustomElementsFromText(text: string, tags: Set<string>) {
    const cleanText = text.replace(/<!--[\s\S]*?-->/g, '')
    const customElementTagRegex = /<([a-z0-9]+(?:-[a-z0-9]+)+)(?=[\s>/]|$)/g
    let match: RegExpExecArray | null
    while ((match = customElementTagRegex.exec(cleanText)) !== null) {
        tags.add(match[1])
    }
}

/**
 * Verifies whether all custom element tags used in the code (that are defined in the CEM tag map)
 * have corresponding non-type imports by traversing the ESTree AST.
 */
export function findMissingCustomElementImports(
    codeOrAst: string | unknown,
    tagMap: Map<string, string>,
): CheckImportsResult {
    const ast = typeof codeOrAst === 'string' ? parseAst(codeOrAst, { lang: 'ts' }) : codeOrAst

    const importedModules = new Set<string>()
    const usedCustomElements = new Set<string>()

    walkAst(ast, node => {
        // 1. Check imports: import ... from '...'
        if (node.type === 'ImportDeclaration') {
            const isTypeOnly =
                node.importKind === 'type' ||
                (Array.isArray(node.specifiers) &&
                    node.specifiers.length > 0 &&
                    node.specifiers.every((s: any) => s.importKind === 'type'))
            if (!isTypeOnly && node.source && typeof (node.source as any).value === 'string') {
                const rawSpecifier = (node.source as any).value as string
                const normalizedSpecifier = rawSpecifier.replace(/\.[a-zA-Z0-9]+$/, '')
                importedModules.add(normalizedSpecifier)
            }
        }

        // 2. Check template literals: `...` or html`...`
        if (node.type === 'TemplateElement' && node.value && typeof (node.value as any).raw === 'string') {
            extractCustomElementsFromText((node.value as any).raw, usedCustomElements)
        }

        // 3. Check plain string literals: '...' or "..."
        if (node.type === 'Literal' && typeof node.value === 'string') {
            extractCustomElementsFromText(node.value, usedCustomElements)
        }

        // 4. Check JSX elements (if applicable): <custom-element>
        if (node.type === 'JSXOpeningElement' && node.name && typeof (node.name as any).name === 'string') {
            const name = (node.name as any).name as string
            if (name.includes('-')) {
                usedCustomElements.add(name)
            }
        }
    })

    const missing: MissingImport[] = []
    for (const tagName of usedCustomElements) {
        const expectedImport = tagMap.get(tagName)
        // If the tag is not present in the CEM tagMap, it is external/local custom element; skip
        if (!expectedImport) continue

        if (!importedModules.has(expectedImport)) {
            missing.push({ tagName, expectedImport })
        }
    }

    return {
        usedCustomElements: Array.from(usedCustomElements),
        missing,
    }
}

export interface CustomElementsManifestPluginOptions {
    packages?: string[]
    manifests?: Array<{
        packageName: string
        manifest: CustomElementsManifest
    }>
}

/**
 * Vite plugin that uses the Custom Elements Manifest ecosystem to ensure all
 * custom element tags used in source files have their defining module imported.
 */
export function customElementsManifestCheckPlugin(options: CustomElementsManifestPluginOptions = {}): Plugin {
    const packages = options.packages ?? ['@material/web']
    const tagMap = new Map<string, string>()

    // Load manifests from options if provided
    if (options.manifests) {
        for (const { packageName, manifest } of options.manifests) {
            const map = buildTagImportMapFromManifest(manifest, packageName)
            for (const [tag, imp] of map) {
                tagMap.set(tag, imp)
            }
        }
    }

    // Load manifests for specified packages
    for (const pkgName of packages) {
        try {
            const manifest = loadManifestForPackage(pkgName)
            const map = buildTagImportMapFromManifest(manifest, pkgName)
            for (const [tag, imp] of map) {
                tagMap.set(tag, imp)
            }
        } catch (err) {
            throw new Error(`Failed to load CEM for "${pkgName}"`, { cause: err })
        }
    }

    return {
        name: 'custom-elements-manifest-check',
        transform(code, id) {
            const cleanId = id.split('?')[0]
            if (!cleanId.endsWith('.ts') || cleanId.endsWith('.d.ts') || cleanId.includes('/node_modules/')) {
                return null
            }
            if (!cleanId.includes('/src/')) {
                return null
            }

            // In Vite 8 (Rolldown), `this.parse(code)` provides the parsed AST directly without extra dependencies
            const ast = typeof this.parse === 'function' ? this.parse(code) : parseAst(code, { lang: 'ts' })
            const { missing } = findMissingCustomElementImports(ast, tagMap)
            if (missing.length > 0) {
                const relativePath = path.relative(process.cwd(), cleanId)
                const missingElements = missing.map(m => `<${m.tagName}> (expected '${m.expectedImport}')`).join(', ')
                this.error(`Missing Custom Element component import(s) in ${relativePath}: ${missingElements}`)
            }

            return null
        },
    }
}
