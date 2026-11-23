<?php

namespace App\Services;

use App\Models\LoginLog;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AdminAuthService extends BaseService
{
    private const MAX_FAILURES = 5;

    private const LOCK_SECONDS = 300;

    public function login(array $credentials, Request $request): array
    {
        $username = trim((string) ($credentials['username'] ?? ''));
        $password = (string) ($credentials['password'] ?? '');
        $ip = (string) $request->ip();
        $lockKey = 'admin_login_fail:'.mb_strtolower($username).':'.$ip;

        if ((int) Cache::get($lockKey, 0) >= self::MAX_FAILURES) {
            $this->writeLoginLog(null, $username, false, '失败次数过多，已临时锁定', $request);
            throw ValidationException::withMessages([
                'username' => ['失败次数过多，请 5 分钟后再试'],
            ]);
        }

        $user = User::where('username', $username)->first();

        if (! $user || ! Hash::check($password, $user->password)) {
            Cache::put($lockKey, (int) Cache::get($lockKey, 0) + 1, self::LOCK_SECONDS);
            $this->writeLoginLog($user, $username, false, '账号或密码错误', $request);
            throw ValidationException::withMessages([
                'username' => ['账号或密码错误'],
            ]);
        }

        if ((int) $user->status !== 1) {
            $this->writeLoginLog($user, $username, false, '账号已禁用', $request);
            throw ValidationException::withMessages([
                'username' => ['账号已禁用'],
            ]);
        }

        Cache::forget($lockKey);
        $user->forceFill([
            'last_login_at' => now(),
            'last_login_ip' => $ip,
        ])->save();

        $token = $user->createToken('admin:'.mb_substr($request->userAgent() ?: 'unknown', 0, 64))->plainTextToken;
        $this->writeLoginLog($user, $username, true, '登录成功', $request);

        return [
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => $this->buildPayload($user),
        ];
    }

    public function buildPayload(User $user): array
    {
        $user->loadMissing('roles');

        return [
            'id' => $user->id,
            'username' => $user->username,
            'nickname' => $user->nickname,
            'status' => (int) $user->status,
            'last_login_at' => $user->last_login_at?->format('Y-m-d H:i:s'),
            'last_login_ip' => $user->last_login_ip,
            'roles' => $user->getRolePayload(),
            'permissions' => $user->getPermissionCodes(),
            'menus' => $user->getMenus(),
            'site' => [
                'name' => SystemConfig::getValue('site_name', '橙子英语'),
                'description' => SystemConfig::getValue('site_description', '英语听读 App 云端管理后台'),
            ],
        ];
    }

    public function updatePassword(User $user, array $data): void
    {
        if (! Hash::check((string) ($data['current_password'] ?? ''), $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => ['当前密码不正确'],
            ]);
        }

        $user->forceFill(['password' => Hash::make((string) $data['new_password'])])->save();
        // 改密后吊销其它设备的后台 token，当前 token 保留。
        $currentId = $user->currentAccessToken()?->id;
        $user->tokens()->when($currentId, fn ($q) => $q->where('id', '!=', $currentId))->delete();
    }

    private function writeLoginLog(?User $user, string $username, bool $success, string $message, Request $request): void
    {
        try {
            LoginLog::create([
                'user_type' => 'admin',
                'user_id' => $user?->id,
                'username' => mb_substr($username, 0, 64),
                'success' => $success ? 1 : 0,
                'message' => $message,
                'ip' => (string) $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
                'created_at' => now(),
            ]);
        } catch (\Throwable) {
            // 日志失败不影响登录
        }
    }
}
