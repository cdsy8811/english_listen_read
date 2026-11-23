<?php

namespace App\Http\Controllers\Api\App;

use App\Http\Controllers\Controller;
use App\Services\AppAuthService;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    public function __construct(private readonly AppAuthService $service) {}

    public function login(Request $request)
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:64'],
            'device_id' => ['required', 'string', 'max:128'],
            'device_name' => ['nullable', 'string', 'max:128'],
            'platform' => ['nullable', 'string', 'max:32'],
            'app_version' => ['nullable', 'string', 'max:32'],
        ]);

        return $this->success($this->service->login($data, $request), '登录成功');
    }

    public function me(Request $request)
    {
        return $this->success($this->service->me($request->user()));
    }

    public function logout(Request $request)
    {
        $request->user()?->currentAccessToken()?->delete();

        return $this->success(null, '已退出登录');
    }
}
