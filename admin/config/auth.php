<?php

use App\Models\AppUser;
use App\Models\User;

return [

    'defaults' => [
        'guard' => env('AUTH_GUARD', 'web'),
        'passwords' => 'users',
    ],

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],

        // 管理后台：users 表
        'admin' => [
            'driver' => 'sanctum',
            'provider' => 'users',
        ],

        // App 端：app_users 表
        'app' => [
            'driver' => 'sanctum',
            'provider' => 'app_users',
        ],
    ],

    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => User::class,
        ],

        'app_users' => [
            'driver' => 'eloquent',
            'model' => AppUser::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => 10800,

];
