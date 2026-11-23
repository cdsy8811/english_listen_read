<?php

namespace App\Services;

use App\Models\AppDevice;
use App\Models\AppUser;
use App\Models\LoginLog;
use App\Models\SystemConfig;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AppAuthService extends BaseService
{
    public function login(array $data, Request $request): array
    {
        $username = trim((string) $data['username']);
        $user = AppUser::where('username', $username)->first();

        if (! $user || ! Hash::check((string) $data['password'], $user->password)) {
            $this->writeLog($user, $username, false, '账号或密码错误', $request);
            throw ValidationException::withMessages(['username' => ['账号或密码错误']]);
        }

        if ((int) $user->status !== 1) {
            $this->writeLog($user, $username, false, '账号已禁用', $request);
            throw ValidationException::withMessages(['username' => ['账号已禁用']]);
        }

        $deviceId = trim((string) ($data['device_id'] ?? ''));
        if ($deviceId === '') {
            throw ValidationException::withMessages(['device_id' => ['缺少设备标识']]);
        }

        $device = AppDevice::updateOrCreate(
            ['app_user_id' => $user->id, 'device_id' => $deviceId],
            [
                'name' => mb_substr((string) ($data['device_name'] ?? ''), 0, 128),
                'platform' => mb_substr((string) ($data['platform'] ?? ''), 0, 32),
                'app_version' => mb_substr((string) ($data['app_version'] ?? ''), 0, 32),
                'last_seen_at' => now(),
                'last_ip' => (string) $request->ip(),
            ]
        );

        // 同一设备重新登录时吊销旧 token，避免 token 无限堆积。
        $user->tokens()->where('name', 'app:'.$device->device_id)->delete();
        $token = $user->createToken('app:'.$device->device_id)->plainTextToken;

        $user->forceFill([
            'last_login_at' => now(),
            'last_login_ip' => (string) $request->ip(),
        ])->save();

        $this->writeLog($user, $username, true, '登录成功', $request);

        return [
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => $user->toProfileArray(),
            'sync' => [
                'protocol_version' => (int) SystemConfig::getValue('sync_protocol_version', 1),
                'cursor' => (int) $user->next_sync_seq - 1,
            ],
        ];
    }

    public function me(AppUser $user): array
    {
        return [
            'user' => $user->toProfileArray(),
            'sync' => [
                'protocol_version' => (int) SystemConfig::getValue('sync_protocol_version', 1),
                'cursor' => (int) $user->next_sync_seq - 1,
            ],
            'counts' => [
                'units' => $user->units()->count(),
                'words' => $user->words()->count(),
                'practice_records' => $user->practiceRecords()->count(),
                'read_articles' => $user->readArticles()->count(),
                'study_sessions' => $user->studySessions()->count(),
            ],
        ];
    }

    public function touchDevice(AppUser $user, string $deviceId, Request $request): void
    {
        if ($deviceId === '') {
            return;
        }

        AppDevice::where('app_user_id', $user->id)
            ->where('device_id', $deviceId)
            ->update([
                'last_seen_at' => now(),
                'last_ip' => (string) $request->ip(),
                'updated_at' => now(),
            ]);
    }

    private function writeLog(?AppUser $user, string $username, bool $success, string $message, Request $request): void
    {
        try {
            LoginLog::create([
                'user_type' => 'app',
                'user_id' => $user?->id,
                'username' => mb_substr($username, 0, 64),
                'success' => $success ? 1 : 0,
                'message' => $message,
                'ip' => (string) $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
                'created_at' => now(),
            ]);
        } catch (\Throwable) {
            // ignore
        }
    }
}
