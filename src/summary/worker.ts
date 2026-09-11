/* eslint-disable unicorn/require-post-message-target-origin */
import {
    AutoTokenizer,
    AutoModelForCausalLM,
    Tensor,
    type PreTrainedModel,
    type PreTrainedTokenizer,
    type ProgressInfo,
} from '@huggingface/transformers'
// @ts-ignore -- Vite `?url` asset import has no type declarations
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { setupTransformersEnv, mapWebGPUError } from '../ml/worker_env'
import type { SummaryWorkerInMessage, SummaryWorkerOutMessage, SummaryWorkerTimings } from './types'
import { buildSummaryPrompt } from './prompt'
import { SUMMARY_MODEL_CACHE_DIR } from './model_downloader'
import { REQUIRED_SUMMARY_MODEL_FILES } from './model_files'

// Configure environment and OPFS cache
setupTransformersEnv({
    cacheDirName: SUMMARY_MODEL_CACHE_DIR,
    requiredFiles: REQUIRED_SUMMARY_MODEL_FILES,
    ortWasmUrl,
})

class SummaryModelManager {
    private static modelInstance: PreTrainedModel | null = null
    private static tokenizerInstance: PreTrainedTokenizer | null = null
    private static currentModelId: string | null = null

    static async getInstances(
        modelId: string,
        onProgress?: (progress: { loaded: number; total: number; file: string }) => void,
    ): Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer }> {
        if (this.modelInstance && this.tokenizerInstance && this.currentModelId === modelId) {
            return { model: this.modelInstance, tokenizer: this.tokenizerInstance }
        }

        await this.dispose()

        if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
            throw new Error('WEBGPU_NOT_AVAILABLE')
        }

        try {
            this.tokenizerInstance = await AutoTokenizer.from_pretrained(modelId, {
                local_files_only: true,
            })

            this.modelInstance = await AutoModelForCausalLM.from_pretrained(modelId, {
                device: 'webgpu',
                dtype: 'q4f16',
                local_files_only: true,
                progress_callback: (info: ProgressInfo) => {
                    if (onProgress && 'file' in info && info.file) {
                        onProgress({
                            loaded: 'loaded' in info ? info.loaded : 0,
                            total: 'total' in info ? info.total : 0,
                            file: info.file,
                        })
                    }
                },
            })

            this.currentModelId = modelId
            return { model: this.modelInstance, tokenizer: this.tokenizerInstance }
        } catch (err: unknown) {
            throw mapWebGPUError(err)
        }
    }

    static async dispose(): Promise<void> {
        if (this.modelInstance) {
            try {
                await this.modelInstance.dispose()
            } catch (e) {
                console.warn('Error disposing summary model:', e)
            }
            this.modelInstance = null
        }
        this.tokenizerInstance = null
        this.currentModelId = null
    }
}

let loadedModelId = ''

self.addEventListener('message', async (event: MessageEvent<SummaryWorkerInMessage>) => {
    const message = event.data

    try {
        switch (message.type) {
            case 'init': {
                loadedModelId = message.modelId

                // 1. Check WebGPU
                if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                    self.postMessage({
                        type: 'error',
                        code: 'WEBGPU_NOT_AVAILABLE',
                        message: 'WebGPU is not supported or available on this device.',
                    } satisfies SummaryWorkerOutMessage)
                    return
                }

                // 2. Load Tokenizer & Model
                try {
                    await SummaryModelManager.getInstances(loadedModelId, progress => {
                        self.postMessage({
                            type: 'download_progress',
                            loaded: progress.loaded,
                            total: progress.total,
                            file: progress.file,
                        } satisfies SummaryWorkerOutMessage)
                    })
                } catch (e) {
                    const errMessage = e instanceof Error ? e.message : String(e)
                    if (errMessage === 'WEBGPU_NOT_AVAILABLE') {
                        self.postMessage({
                            type: 'error',
                            code: 'WEBGPU_NOT_AVAILABLE',
                            message: 'WebGPU is not available.',
                        } satisfies SummaryWorkerOutMessage)
                        return
                    }
                    if (errMessage === 'WEBGPU_FP16_NOT_SUPPORTED') {
                        self.postMessage({
                            type: 'error',
                            code: 'WEBGPU_FP16_NOT_SUPPORTED',
                            message: 'WebGPU FP16 is not supported by your GPU hardware.',
                        } satisfies SummaryWorkerOutMessage)
                        return
                    }
                    self.postMessage({
                        type: 'error',
                        code: 'MODEL_LOAD_FAILED',
                        message: `Failed to load summary model: ${errMessage}`,
                    } satisfies SummaryWorkerOutMessage)
                    return
                }

                self.postMessage({ type: 'ready' } satisfies SummaryWorkerOutMessage)
                break
            }

            case 'summarize': {
                const t0 = performance.now()
                self.postMessage({
                    type: 'summary_progress',
                    stage: 'generating',
                    progress: 0,
                } satisfies SummaryWorkerOutMessage)

                const { model, tokenizer } = await SummaryModelManager.getInstances(loadedModelId)

                const messages = [
                    {
                        role: 'user',
                        content: buildSummaryPrompt(message.text, message.prompt),
                    },
                ]

                const prompt = (
                    tokenizer.apply_chat_template as (messages: unknown, options: Record<string, unknown>) => string
                )(messages, {
                    enable_thinking: false,
                    add_generation_prompt: true,
                    tokenize: false,
                })

                const inputs = await tokenizer(prompt)

                self.postMessage({
                    type: 'summary_progress',
                    stage: 'generating',
                    progress: 0.3,
                } satisfies SummaryWorkerOutMessage)

                const outputs = await model.generate({
                    ...inputs,
                    max_new_tokens: 512,
                    do_sample: false,
                })

                self.postMessage({
                    type: 'summary_progress',
                    stage: 'generating',
                    progress: 0.9,
                } satisfies SummaryWorkerOutMessage)

                // Decode output tokens (slice generated tokens: outputs[:, input_length:] in Python)
                const inputLength = inputs.input_ids.dims.at(-1) ?? 0
                const newTokens = (outputs as Tensor).slice(null, [inputLength, null] as unknown as number[])
                const decoded = tokenizer.batch_decode(newTokens as Parameters<typeof tokenizer.batch_decode>[0], {
                    skip_special_tokens: true,
                })
                const summaryText = (decoded[0] || '').trim()

                const inferenceMs = Math.round(performance.now() - t0)
                const timings: SummaryWorkerTimings = {
                    modelLoadMs: 0,
                    inferenceMs,
                }

                self.postMessage({
                    type: 'result',
                    summaryText,
                    timings,
                } satisfies SummaryWorkerOutMessage)
                break
            }

            case 'dispose': {
                await SummaryModelManager.dispose()
                break
            }
        }
    } catch (e) {
        self.postMessage({
            type: 'error',
            code: 'SUMMARIZE_FAILED',
            message: e instanceof Error ? e.message : String(e),
        } satisfies SummaryWorkerOutMessage)
    }
})
