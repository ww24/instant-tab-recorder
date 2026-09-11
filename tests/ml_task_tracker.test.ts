import { describe, it, expect } from 'vitest'
import { TaskTracker } from '../src/ml/task_tracker'

describe('TaskTracker', () => {
    it('initial state has no active tasks', () => {
        const tracker = new TaskTracker<string>()
        expect(tracker.hasActiveTasks()).toBe(false)
        expect(tracker.has('video-1.mp4')).toBe(false)
    })

    it('starts and finishes tasks correctly', () => {
        const tracker = new TaskTracker<string>()
        expect(tracker.start('video-1.mp4')).toBe(true)
        expect(tracker.has('video-1.mp4')).toBe(true)
        expect(tracker.hasActiveTasks()).toBe(true)

        // Cannot start duplicate task
        expect(tracker.start('video-1.mp4')).toBe(false)

        // Can start another task
        expect(tracker.start('video-2.mp4')).toBe(true)
        expect(tracker.has('video-2.mp4')).toBe(true)

        tracker.finish('video-1.mp4')
        expect(tracker.has('video-1.mp4')).toBe(false)
        expect(tracker.hasActiveTasks()).toBe(true) // video-2 still running

        tracker.finish('video-2.mp4')
        expect(tracker.has('video-2.mp4')).toBe(false)
        expect(tracker.hasActiveTasks()).toBe(false)
    })
})
