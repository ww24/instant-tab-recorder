export function errorToString(e: unknown): string {
    if (!(e instanceof Error)) return String(e)
    let msg = (e.stack ?? String(e)).replaceAll(/chrome-extension:\/\/[a-p]+\//g, '')
    if (e.cause) {
        msg += '\nCaused by: ' + errorToString(e.cause)
    }
    return msg
}
