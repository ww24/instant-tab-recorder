import type { RequiredModelFile } from '../ml/model_files'

export const SUMMARY_MODEL_NAME = 'Gemma 4 E2B'
export const SUMMARY_MODEL_REPO = 'onnx-community/gemma-4-E2B-it-ONNX'
export const SUMMARY_MODEL_REVISION = '9f4bef82ea6e296bc69f8a2f5939f73af81b07a6'

export const REQUIRED_SUMMARY_MODEL_FILES: readonly RequiredModelFile[] = [
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'config.json',
        size: 5549,
        sha256: '5494e6677d9e150ea20ba3101ae8a32b0f141004626f052725d8bf48991b9faa',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'generation_config.json',
        size: 238,
        sha256: 'e6a0b50de21a511f15ac4857b7f227f68ee60ecb1f11255d07b75e0bdc60e155',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'tokenizer.json',
        size: 19439251,
        sha256: '47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'tokenizer_config.json',
        size: 18807,
        sha256: '06afbf54e228050cba79c4a0afd83543cc89070a2d62b8337d0aa8b4cdc348c3',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'chat_template.jinja',
        size: 16317,
        sha256: '781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'onnx/decoder_model_merged_q4f16.onnx',
        size: 673231,
        sha256: '73c0f1fe04f9a3a048fb3319c0671b6cf0346bf33a3a8624c853bcffe01c24a4',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'onnx/decoder_model_merged_q4f16.onnx_data',
        size: 1519700992,
        sha256: '3b27245a7396cb7039a4e4118bd2a8aa35106bae381522edf7c4867b5f22bb10',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'onnx/embed_tokens_q4f16.onnx',
        size: 5621,
        sha256: 'd7ca53f6a169471b5699b2f57ee4c7aa2c73732b0152f3909e64b71384444825',
    },
    {
        repo: SUMMARY_MODEL_REPO,
        revision: SUMMARY_MODEL_REVISION,
        name: 'onnx/embed_tokens_q4f16.onnx_data',
        size: 1590689792,
        sha256: '024b199e6358ed42970f807686add5f9430d7e254ca7ce22fc9c83f015b9c517',
    },
] as const
