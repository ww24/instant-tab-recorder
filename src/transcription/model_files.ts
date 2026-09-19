import type { RequiredModelFile } from '../ml/model_files'

export const TRANSCRIPTION_MODEL_NAME = 'Whisper Large v3 Turbo'
export const TRANSCRIPTION_MODEL_REPO = 'onnx-community/whisper-large-v3-turbo'
export const TRANSCRIPTION_MODEL_REVISION = '360ebcde2559d60bb474678be3c1de9ef347d01a'
export const VAD_MODEL_REPO = 'onnx-community/silero-vad'
export const VAD_MODEL_REVISION = 'e71cae966052b992a7eca6b17738916ce0eca4ec'

export const REQUIRED_TRANSCRIPTION_MODEL_FILES: readonly RequiredModelFile[] = [
    // Whisper
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'config.json',
        size: 1332,
        sha256: '35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1',
    },
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'generation_config.json',
        size: 3897,
        sha256: '16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f',
    },
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'tokenizer.json',
        size: 2480617,
        sha256: '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca',
    },
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'tokenizer_config.json',
        size: 282843,
        sha256: '844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389',
    },
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'preprocessor_config.json',
        size: 340,
        sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711',
    },
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'onnx/encoder_model_fp16.onnx',
        size: 1274342603,
        sha256: 'fdadc70836e6b028fd5e580417c312208dad073d2d01e509e2d127c1373399d8',
    },
    {
        repo: TRANSCRIPTION_MODEL_REPO,
        revision: TRANSCRIPTION_MODEL_REVISION,
        name: 'onnx/decoder_model_merged_q4f16.onnx',
        size: 193505017,
        sha256: '45981cdd958a4c8e1447839850d2e6e27e30974ccbe31b4a1e5ebe9ad8965a5f',
    },
    // Silero VAD
    {
        repo: VAD_MODEL_REPO,
        revision: VAD_MODEL_REVISION,
        name: 'onnx/model.onnx',
        size: 2243022,
        sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808',
    },
] as const
