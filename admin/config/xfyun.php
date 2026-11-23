<?php

return [
    'app_id' => env('XFYUN_APPID', ''),
    'api_key' => env('XFYUN_API_KEY', ''),
    'api_secret' => env('XFYUN_API_SECRET', ''),

    'maas' => [
        'base_url' => env('XFYUN_MAAS_BASE_URL', 'https://maas-api.cn-huabei-1.xf-yun.com/v2'),
        'api_key' => env('XFYUN_MAAS_API_KEY', ''),
        'model' => env('XFYUN_MAAS_MODEL', 'spark-x2.6'),
    ],

    'ocr' => [
        'url' => env('XFYUN_OCR_URL', 'https://cbm01.cn-huabei-1.xf-yun.com/v1/private/se75ocrbm'),
        'sign_host' => env('XFYUN_OCR_SIGN_HOST', 'cbm01.cn-huabei-1.xf-yun.com'),
        'max_bytes' => 4 * 1024 * 1024,
    ],

    'asr' => [
        'wss' => env('XFYUN_IAT_WSS', 'wss://iat-api.xfyun.cn/v2/iat'),
        'max_bytes' => 4 * 1024 * 1024,
        'max_seconds' => 60,
    ],

    'tts' => [
        'wss' => env('XFYUN_TTS_WSS', 'wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6'),
        'vcn_zh' => env('XFYUN_TTS_VCN_ZH', 'x5_lingxiaoxuan_flow'),
        'vcn_en' => env('XFYUN_TTS_VCN_EN', 'x5_EnUs_Lila_flow'),
    ],

    'timeout' => (int) env('XFYUN_HTTP_TIMEOUT', 90),
    'tts_cache_mb' => (int) env('XFYUN_TTS_CACHE_MB', 2048),
    'daily_quota' => (int) env('AI_DAILY_QUOTA', 500),
];
