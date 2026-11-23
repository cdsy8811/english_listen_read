<?php

use Illuminate\Support\Facades\Route;

require __DIR__.'/api/admin.php';
require __DIR__.'/api/app.php';

Route::get('/health', fn () => response()->json([
    'code' => 200,
    'msg' => 'ok',
    'data' => [
        'service' => 'orange-english-admin',
        'time' => now()->toDateTimeString(),
    ],
    'timestamp' => time(),
]));
