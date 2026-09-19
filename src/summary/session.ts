/* eslint-disable unicorn/require-post-message-target-origin */
import type { SummaryResult, SummaryWorkerInMessage, SummaryWorkerOutMessage } from './types'
import { SUMMARY_MODEL_REPO } from './model_files'
import type { TranscriptionResult } from '../transcription/types'
import { BaseMLSession, abortable, type BaseMLSessionDeps } from '../ml/base_session'
import { initializeWorker, executeWorkerTask } from '../ml/worker_client'

export interface SummarySessionDeps extends BaseMLSessionDeps {
    getTranscription(path: string): Promise<TranscriptionResult | null>
    saveSummary(path: string, result: SummaryResult): Promise<void>
    getPrompt?(): string | undefined
}

/**
 * Manages summary execution in the background using Gemma 4.
 * Releases all resources (Web Worker & GPU/RAM) immediately when finished.
 */
export class SummarySession extends BaseMLSession<SummarySessionDeps> {
    constructor(deps: SummarySessionDeps) {
        super(deps, 'Summary')
    }

    isSummarizing(path: string): boolean {
        return this.isTaskActive(path)
    }

    async summarize(path: string): Promise<void> {
        return this.runTask(
            path,
            async (signal, setWorker) => {
                // 1. Get transcription (cancellable before Worker is created)
                const transcription = await abortable(this.deps.getTranscription(path), signal)

                if (!transcription || !transcription.segments || transcription.segments.length === 0) {
                    throw new Error('No transcription available to summarize')
                }

                const transcriptText = transcription.segments
                    .map(s => s.text)
                    .join('\n')
                    .trim()
                if (!transcriptText) {
                    throw new Error('Transcription text is empty')
                }

                // 2. Initialize Worker
                const worker = this.deps.createWorker()
                setWorker(worker)
                const modelId = SUMMARY_MODEL_REPO

                await abortable(
                    initializeWorker({
                        worker,
                        initMessage: { type: 'init', modelId },
                        errorPrefix: 'Summary worker',
                        onDownloadProgress: (loaded, total) => {
                            this.deps
                                .broadcastMessage({
                                    type: 'summary-progress',
                                    path,
                                    stage: 'model_load',
                                    loaded,
                                    total,
                                })
                                .catch(() => {})
                        },
                    }),
                    signal,
                )

                // 3. Execute summarization
                const prompt = this.deps.getPrompt ? this.deps.getPrompt() : undefined
                const resultMsg = await executeWorkerTask<
                    SummaryWorkerInMessage,
                    Extract<SummaryWorkerOutMessage, { type: 'result' }>
                >({
                    worker,
                    signal,
                    message: {
                        type: 'summarize',
                        text: transcriptText,
                        prompt,
                    },
                    errorPrefix: 'Summary worker',
                    isProgress: (data: unknown): data is SummaryWorkerOutMessage =>
                        typeof data === 'object' && data !== null && (data as any).type === 'summary_progress',
                    onProgress: (data: any) => {
                        this.deps
                            .broadcastMessage({
                                type: 'summary-progress',
                                path,
                                stage: data.stage,
                                loaded: Math.round(data.progress * 100),
                                total: 100,
                            })
                            .catch(() => {})
                    },
                    isResult: (data: unknown): data is Extract<SummaryWorkerOutMessage, { type: 'result' }> =>
                        typeof data === 'object' && data !== null && (data as any).type === 'result',
                })

                // 4. Save result to IndexedDB
                signal.throwIfAborted()

                const summaryResult: SummaryResult = {
                    text: resultMsg.summaryText,
                    summarizedAt: Date.now(),
                    modelId,
                }

                await this.deps.saveSummary(path, summaryResult)

                // 5. Broadcast completion notification
                await this.deps.broadcastMessage({
                    type: 'summary-complete',
                    path,
                    summary: summaryResult,
                })
            },
            { errorMessageType: 'summary-error' },
        )
    }
}
