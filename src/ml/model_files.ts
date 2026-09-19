import { formatFileSize } from '../format'

/**
 * Metadata for a model file hosted on Hugging Face.
 */
export interface RequiredModelFile {
    readonly repo: string
    readonly revision: string
    readonly name: string
    readonly size: number
    readonly sha256: string
}

/**
 * Builds the Hugging Face download URL for a model file.
 */
export function getModelFileUrl(file: RequiredModelFile): string {
    return `https://huggingface.co/${file.repo}/resolve/${file.revision}/${file.name}`
}

/**
 * Calculates the total size of a list of model files in bytes.
 */
export function calculateTotalModelSize(files: readonly RequiredModelFile[]): number {
    return files.reduce((acc, f) => acc + f.size, 0)
}

/**
 * Formats the total size of a list of model files as a human-readable string (e.g. "1.5 GB").
 */
export function formatTotalModelSize(files: readonly RequiredModelFile[], fractionDigits: number = 1): string {
    return formatFileSize(calculateTotalModelSize(files), fractionDigits)
}
