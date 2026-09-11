import { BaseModelDownloader } from '../ml/model_downloader'
import { REQUIRED_SUMMARY_MODEL_FILES } from './model_files'
import { OPFSModelCache } from '../ml/opfs_model_cache'
import { calculateTotalModelSize, formatTotalModelSize } from '../ml/model_files'

export const SUMMARY_MODEL_CACHE_DIR = 'summary-model-cache'

/**
 * Downloads summary model files directly from HuggingFace to OPFS.
 */
export class SummaryModelDownloader extends BaseModelDownloader {
    constructor() {
        super(REQUIRED_SUMMARY_MODEL_FILES, {
            cache: new OPFSModelCache(SUMMARY_MODEL_CACHE_DIR, REQUIRED_SUMMARY_MODEL_FILES),
            errorPrefix: 'Summary model download',
        })
    }

    /**
     * Returns the total estimated size of all required summary model files in bytes.
     */
    static getTotalSize(): number {
        return calculateTotalModelSize(REQUIRED_SUMMARY_MODEL_FILES)
    }

    /**
     * Returns the formatted total size string (e.g. "2.9 GB").
     */
    static getFormattedTotalSize(fractionDigits: number = 1): string {
        return formatTotalModelSize(REQUIRED_SUMMARY_MODEL_FILES, fractionDigits)
    }
}
