import type { RequiredModelFile } from './model_files'

/**
 * Common cache interface for storing and retrieving AI model files.
 */
export interface ModelCache {
    /**
     * Normalizes a URL or path key to a clean relative cache key.
     */
    normalizeKey(key: string): string

    /**
     * Generates a collision-resistant filesystem file name for the given key.
     */
    getCacheFileName(rawKey: string): Promise<string>

    /**
     * Checks if the resource is in the cache and returns a Response if found.
     */
    match(request: Request | string): Promise<Response | undefined>

    /**
     * Stores a Response stream or buffer into the cache.
     */
    put(request: Request | string, response: Response): Promise<void>

    /**
     * Deletes a cached resource.
     */
    delete(request: Request | string): Promise<boolean>

    /**
     * Clears all cached resources in this cache.
     */
    clear(): Promise<void>

    /**
     * Checks if all required model files exist in the cache with matching sizes.
     */
    hasCache(requiredFiles?: readonly RequiredModelFile[]): Promise<boolean>

    /**
     * Checks if all required model files exist in the cache with matching SHA-256 hashes.
     */
    verifyCache(requiredFiles?: readonly RequiredModelFile[]): Promise<boolean>
}
