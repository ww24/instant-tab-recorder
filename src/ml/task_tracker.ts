/**
 * Tracks running task identifiers to prevent concurrent duplicate executions.
 */
export class TaskTracker<TKey = string> {
    private readonly activeTasks = new Set<TKey>()

    /**
     * Checks if a task with the given key is currently active.
     */
    has(key: TKey): boolean {
        return this.activeTasks.has(key)
    }

    /**
     * Attempts to start a task with the given key.
     * Returns true if successfully started, or false if already active.
     */
    start(key: TKey): boolean {
        if (this.activeTasks.has(key)) {
            return false
        }
        this.activeTasks.add(key)
        return true
    }

    /**
     * Marks a task as finished and removes it from active tracking.
     */
    finish(key: TKey): void {
        this.activeTasks.delete(key)
    }

    /**
     * Returns true if there are any active tasks running.
     */
    hasActiveTasks(): boolean {
        return this.activeTasks.size > 0
    }
}
