export const WHISPER_MODEL_REPO = 'onnx-community/whisper-large-v3-turbo'
export const WHISPER_MODEL_REVISION = '360ebcde2559d60bb474678be3c1de9ef347d01a'
export const VAD_MODEL_REPO = 'onnx-community/silero-vad'
export const VAD_MODEL_REVISION = 'e71cae966052b992a7eca6b17738916ce0eca4ec'

export interface RequiredModelFile {
    repo: string
    revision: string
    name: string
    size: number
}

export function getModelFileUrl(file: RequiredModelFile): string {
    return `https://huggingface.co/${file.repo}/resolve/${file.revision}/${file.name}`
}

export const REQUIRED_MODEL_FILES: readonly RequiredModelFile[] = [
    // Whisper
    { repo: WHISPER_MODEL_REPO, revision: WHISPER_MODEL_REVISION, name: 'config.json', size: 1332 },
    { repo: WHISPER_MODEL_REPO, revision: WHISPER_MODEL_REVISION, name: 'generation_config.json', size: 3897 },
    { repo: WHISPER_MODEL_REPO, revision: WHISPER_MODEL_REVISION, name: 'tokenizer.json', size: 2480617 },
    { repo: WHISPER_MODEL_REPO, revision: WHISPER_MODEL_REVISION, name: 'tokenizer_config.json', size: 282843 },
    { repo: WHISPER_MODEL_REPO, revision: WHISPER_MODEL_REVISION, name: 'preprocessor_config.json', size: 340 },
    {
        repo: WHISPER_MODEL_REPO,
        revision: WHISPER_MODEL_REVISION,
        name: 'onnx/encoder_model_fp16.onnx',
        size: 1274342603,
    },
    {
        repo: WHISPER_MODEL_REPO,
        revision: WHISPER_MODEL_REVISION,
        name: 'onnx/decoder_model_merged_q4f16.onnx',
        size: 193505017,
    },
    // Silero VAD
    { repo: VAD_MODEL_REPO, revision: VAD_MODEL_REVISION, name: 'onnx/model.onnx', size: 2243022 },
] as const
