<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Admin\SystemUserService;
use Illuminate\Http\Request;

class SystemUserController extends Controller
{
    public function __construct(private readonly SystemUserService $service) {}

    public function index(Request $request)
    {
        return $this->successPage($this->service->list($request));
    }

    public function options()
    {
        return $this->success($this->service->options());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'min:8', 'max:64'],
            'nickname' => ['nullable', 'string', 'max:64'],
            'email' => ['nullable', 'email', 'max:128'],
            'status' => ['nullable', 'integer', 'in:0,1'],
            'role_ids' => ['nullable', 'array'],
            'role_ids.*' => ['integer'],
        ]);

        $user = $this->service->create($data);

        return $this->success($this->service->row($user), '创建成功');
    }

    public function update(Request $request, User $user)
    {
        $data = $request->validate([
            'username' => ['sometimes', 'string', 'max:64'],
            'password' => ['nullable', 'string', 'min:8', 'max:64'],
            'nickname' => ['sometimes', 'nullable', 'string', 'max:64'],
            'email' => ['sometimes', 'nullable', 'email', 'max:128'],
            'status' => ['sometimes', 'integer', 'in:0,1'],
            'role_ids' => ['sometimes', 'array'],
            'role_ids.*' => ['integer'],
        ]);

        $user = $this->service->update($request->user(), $user, $data);

        return $this->success($this->service->row($user), '保存成功');
    }

    public function destroy(Request $request, User $user)
    {
        $this->service->destroy($request->user(), $user);

        return $this->success(null, '已删除');
    }

    public function resetPassword(Request $request, User $user)
    {
        $data = $request->validate([
            'password' => ['required', 'string', 'min:8', 'max:64'],
        ]);

        $this->service->resetPassword($user, $data['password']);

        return $this->success(null, '密码已重置');
    }
}
