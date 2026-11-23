<?php

use App\Http\Controllers\Api\Admin\AiUsageController;
use App\Http\Controllers\Api\Admin\AppUserController;
use App\Http\Controllers\Api\Admin\AuthController;
use App\Http\Controllers\Api\Admin\DashboardController;
use App\Http\Controllers\Api\Admin\LibraryController;
use App\Http\Controllers\Api\Admin\PermissionController;
use App\Http\Controllers\Api\Admin\RecordController;
use App\Http\Controllers\Api\Admin\RoleController;
use App\Http\Controllers\Api\Admin\SystemController;
use App\Http\Controllers\Api\Admin\SystemUserController;
use Illuminate\Support\Facades\Route;

// 管理后台 API：统一挂载在 /api/admin。
Route::prefix('admin')->group(function () {
    Route::prefix('auth')->group(function () {
        Route::get('config', [AuthController::class, 'config']);
        Route::post('login', [AuthController::class, 'login'])->middleware('throttle:8,1');

        Route::middleware('auth:admin')->group(function () {
            Route::get('me', [AuthController::class, 'me']);
            Route::post('logout', [AuthController::class, 'logout']);
            Route::put('password', [AuthController::class, 'updatePassword']);
        });
    });

    Route::middleware('auth:admin')->group(function () {
        // 公用选项：任意登录管理员可读取，仅返回 id / 名称。
        Route::get('options/app-users', [AppUserController::class, 'options']);
        Route::get('options/roles', [RoleController::class, 'options']);
        Route::get('options/admins', [SystemUserController::class, 'options']);
        Route::get('options/permissions', [PermissionController::class, 'flat']);

        Route::get('dashboard', [DashboardController::class, 'overview'])->middleware('permission:dashboard');

        Route::middleware('permission:app_user')->prefix('app-users')->group(function () {
            Route::get('', [AppUserController::class, 'index']);
            Route::post('', [AppUserController::class, 'store'])->middleware('permission:app_user:add');
            Route::get('{id}', [AppUserController::class, 'show'])->whereNumber('id');
            Route::put('{id}', [AppUserController::class, 'update'])->whereNumber('id')->middleware('permission:app_user:edit');
            Route::delete('{id}', [AppUserController::class, 'destroy'])->whereNumber('id')->middleware('permission:app_user:remove');
            Route::post('{id}/reset-password', [AppUserController::class, 'resetPassword'])->whereNumber('id')->middleware('permission:app_user:reset_password');
            Route::get('{id}/devices', [AppUserController::class, 'devices'])->whereNumber('id');
        });

        Route::middleware('permission:library')->prefix('library')->group(function () {
            Route::get('units', [LibraryController::class, 'units']);
            Route::post('units', [LibraryController::class, 'storeUnit'])->middleware('permission:library:add');
            Route::put('units/{unit}', [LibraryController::class, 'updateUnit'])->middleware('permission:library:edit');
            Route::delete('units/{unit}', [LibraryController::class, 'destroyUnit'])->middleware('permission:library:remove');
            Route::get('words', [LibraryController::class, 'words']);
            Route::get('words/export', [LibraryController::class, 'exportWords'])->middleware('permission:library:export');
            Route::post('units/{unit}/words', [LibraryController::class, 'storeWord'])->middleware('permission:library:add');
            Route::put('words/{word}', [LibraryController::class, 'updateWord'])->middleware('permission:library:edit');
            Route::delete('words/{word}', [LibraryController::class, 'destroyWord'])->middleware('permission:library:remove');
        });

        Route::middleware('permission:read')->prefix('read')->group(function () {
            Route::get('articles', [RecordController::class, 'articles']);
            Route::get('articles/{article}', [RecordController::class, 'articleShow']);
            Route::delete('articles/{article}', [RecordController::class, 'articleDestroy'])->middleware('permission:read:remove');
            Route::get('records', [RecordController::class, 'readRecords']);
        });

        Route::get('practice-records', [RecordController::class, 'practiceRecords'])->middleware('permission:practice_record');

        Route::middleware('permission:study_session')->prefix('study')->group(function () {
            Route::get('sessions', [RecordController::class, 'sessions']);
            Route::get('summary', [RecordController::class, 'sessionSummary']);
        });

        Route::prefix('ai')->group(function () {
            Route::get('call-logs', [AiUsageController::class, 'logs'])->middleware('permission:ai:call_log');
            Route::get('summary', [AiUsageController::class, 'summary'])->middleware('permission:ai:call_log');
            Route::get('tts-assets', [AiUsageController::class, 'ttsAssets'])->middleware('permission:ai:tts_cache');
            Route::get('tts-stats', [AiUsageController::class, 'ttsStats'])->middleware('permission:ai:tts_cache');
            Route::delete('tts-assets/{asset}', [AiUsageController::class, 'destroyTtsAsset'])->middleware('permission:ai:tts_cache');
            Route::post('tts-assets/clear', [AiUsageController::class, 'clearTtsAssets'])->middleware('permission:ai:tts_cache');
        });

        Route::prefix('system')->group(function () {
            Route::middleware('permission:system:user')->group(function () {
                Route::get('users', [SystemUserController::class, 'index']);
                Route::post('users', [SystemUserController::class, 'store'])->middleware('permission:system:user:add');
                Route::put('users/{user}', [SystemUserController::class, 'update'])->middleware('permission:system:user:edit');
                Route::delete('users/{user}', [SystemUserController::class, 'destroy'])->middleware('permission:system:user:remove');
                Route::post('users/{user}/reset-password', [SystemUserController::class, 'resetPassword'])->middleware('permission:system:user:edit');
            });

            Route::middleware('permission:system:role')->group(function () {
                Route::get('roles', [RoleController::class, 'index']);
                Route::post('roles', [RoleController::class, 'store'])->middleware('permission:system:role:edit');
                Route::put('roles/{role}', [RoleController::class, 'update'])->middleware('permission:system:role:edit');
                Route::delete('roles/{role}', [RoleController::class, 'destroy'])->middleware('permission:system:role:edit');
                Route::post('roles/{role}/permissions', [RoleController::class, 'assignPermissions'])->middleware('permission:system:role:edit');
            });

            Route::middleware('permission:system:permission')->group(function () {
                Route::get('permissions', [PermissionController::class, 'index']);
                Route::post('permissions', [PermissionController::class, 'store'])->middleware('permission:system:permission:edit');
                Route::put('permissions/{permission}', [PermissionController::class, 'update'])->middleware('permission:system:permission:edit');
                Route::delete('permissions/{permission}', [PermissionController::class, 'destroy'])->middleware('permission:system:permission:edit');
            });

            Route::middleware('permission:system:log')->group(function () {
                Route::get('operation-logs', [SystemController::class, 'operationLogs']);
                Route::get('login-logs', [SystemController::class, 'loginLogs']);
            });

            Route::get('configs', [SystemController::class, 'configs'])->middleware('permission:system:config');
            Route::post('configs', [SystemController::class, 'updateConfigs'])->middleware('permission:system:config');
        });
    });
});
