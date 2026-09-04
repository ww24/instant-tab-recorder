/**
 * Polyfill / Shim for Web Worker environment.
 * In Web Workers, `window` and `document` do not exist.
 * Certain bundler helpers (such as Vite's modulePreload / preloadError handler)
 * and third-party libraries (like ONNX Runtime Web / Transformers.js dynamic imports)
 * may reference `window` or `document`.
 */
if (typeof self !== 'undefined') {
    const globalObj = self as unknown as Record<string, unknown>
    if (typeof globalObj.window === 'undefined') {
        globalObj.window = globalObj
    }
    if (typeof globalObj.document === 'undefined') {
        globalObj.document = {
            createElement: () => ({
                setAttribute: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                relList: { supports: () => false },
            }),
            getElementsByTagName: () => [],
            querySelector: () => null,
            head: {
                appendChild: () => {},
                removeChild: () => {},
            },
        }
    }
}
