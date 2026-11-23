<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Admin\ConfigService;
use App\Services\AdminAuthService;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    public function __construct(private readonly AdminAuthService $service) {}

    public function config(ConfigService $configService)
    {
        return $this->success($configService->publicBasic());
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:64'],
        ]);

        return $this->success($this->service->login($data, $request), '登录成功');
    }

    public function me(Request $request)
    {
        return $this->success($this->service->buildPayload($request->user()));
    }

    public function logout(Request $request)
    {
        $request->user()?->currentAccessToken()?->delete();

        return $this->success(null, '已退出登录');
    }

    public function updatePassword(Request $request)
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8', 'max:64', 'confirmed'],
        ]);

        $this->service->updatePassword($request->user(), $data);

        return $this->success(null, '密码修改成功');
    }
}
