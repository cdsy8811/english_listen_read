<?php

use App\Http\Controllers\Api\App\AiController;
use App\Http\Controllers\Api\App\AuthController;
use App\Http\Controllers\Api\App\SyncController;
use Illuminate\Support\Facades\Route;

// App 端 API：统一挂载在 /api/v1。
Route::prefix('v1')->group(function () {
    Route::get('meta', fn () => response()->json([
        'code' => 200,
        'msg' => 'ok',
        'data' => [
            'name' => '橙子英语',
            'protocol_version' => (int) config('sync.protocol_version', 1),
            'server_time_ms' => (int) floor(microtime(true) * 1000),
        ],
        'timestamp' => time(),
    ]));

    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

    Route::middleware(['auth:app', 'app.user'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout']);

        Route::get('sync/pull', [SyncController::class, 'pull']);
        Route::post('sync/push', [SyncController::class, 'push']);
        Route::get('sync/status', [SyncController::class, 'status']);

        Route::prefix('ai')->middleware('throttle:60,1')->group(function () {
            Route::post('ocr', [AiController::class, 'ocr']);
            Route::post('extract', [AiController::class, 'extract']);
            Route::post('evaluate', [AiController::class, 'evaluate']);
            Route::post('dict', [AiController::class, 'dict']);
            Route::post('gloss', [AiController::class, 'gloss']);
            Route::post('tts', [AiController::class, 'tts']);
            Route::post('asr', [AiController::class, 'asr']);
            Route::post('passage-translate', [AiController::class, 'passageTranslate']);
            Route::post('passage-evaluate', [AiController::class, 'passageEvaluate']);
        });
    });
});
