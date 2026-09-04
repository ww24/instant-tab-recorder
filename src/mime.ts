/**
 * Extension to MIME type mapping
 */
const extensionToMimeType: Record<string, string> = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.webp': 'image/webp',
    '.vtt': 'text/vtt; charset=utf-8',
    '.srt': 'application/x-subrip',
}

/**
 * Get MIME type from file extension
 * @param filename - The filename or path to extract extension from
 * @returns The MIME type string, defaults to 'application/octet-stream' for unknown extensions
 */
export function getMimeTypeFromExtension(filename: string): string {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
    return extensionToMimeType[ext] ?? 'application/octet-stream'
}
