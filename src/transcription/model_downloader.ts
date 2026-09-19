import { BaseModelDownloader } from '../ml/model_downloader'
import { REQUIRED_TRANSCRIPTION_MODEL_FILES } from './model_files'
import { OPFSModelCache } from '../ml/opfs_model_cache'
import { calculateTotalModelSize, formatTotalModelSize } from '../ml/model_files'

export const TRANSCRIPTION_MODEL_CACHE_DIR = 'transcription-model-cache'

/**
 * Downloads transcription model files directly from HuggingFace to OPFS.
 */
export class TranscriptionModelDownloader extends BaseModelDownloader {
    constructor() {
        super(REQUIRED_TRANSCRIPTION_MODEL_FILES, {
            cache: new OPFSModelCache(TRANSCRIPTION_MODEL_CACHE_DIR, REQUIRED_TRANSCRIPTION_MODEL_FILES),
            errorPrefix: 'Model download',
        })
    }

    /**
     * Returns the total estimated size of all required transcription model files in bytes.
     */
    static getTotalSize(): number {
        return calculateTotalModelSize(REQUIRED_TRANSCRIPTION_MODEL_FILES)
    }

    /**
     * Returns the formatted total size string (e.g. "1.5 GB").
     */
    static getFormattedTotalSize(fractionDigits: number = 1): string {
        return formatTotalModelSize(REQUIRED_TRANSCRIPTION_MODEL_FILES, fractionDigits)
    }
}
