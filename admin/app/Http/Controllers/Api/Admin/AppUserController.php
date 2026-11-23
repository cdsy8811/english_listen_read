<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppUser;
use App\Services\Admin\AppUserService;
use Illuminate\Http\Request;

class AppUserController extends Controller
{
    public function __construct(private readonly AppUserService $service) {}

    public function index(Request $request)
    {
        return $this->successPage($this->service->list($request));
    }

    public function options(Request $request)
    {
        return $this->success($this->service->options($request));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'min:8', 'max:64'],
            'nickname' => ['nullable', 'string', 'max:64'],
            'status' => ['nullable', 'integer', 'in:0,1'],
        ]);

        $user = $this->service->create($data);

        return $this->success($this->service->row($user), '创建成功');
    }

    public function show(string $id)
    {
        $user = AppUser::withTrashed()->findOrFail($id);

        return $this->success($this->service->overview($user));
    }

    public function update(Request $request, string $id)
    {
        $user = AppUser::findOrFail($id);
        $data = $request->validate([
            'username' => ['sometimes', 'string', 'max:64'],
            'password' => ['nullable', 'string', 'min:8', 'max:64'],
            'nickname' => ['sometimes', 'nullable', 'string', 'max:64'],
            'status' => ['sometimes', 'integer', 'in:0,1'],
        ]);

        $user = $this->service->update($user, $data);

        return $this->success($this->service->row($user), '保存成功');
    }

    public function destroy(string $id)
    {
        $user = AppUser::findOrFail($id);
        $this->service->destroy($user);

        return $this->success(null, '已删除');
    }

    public function resetPassword(Request $request, string $id)
    {
        $data = $request->validate([
            'password' => ['required', 'string', 'min:8', 'max:64'],
        ]);

        $this->service->resetPassword(AppUser::findOrFail($id), $data['password']);

        return $this->success(null, '密码已重置');
    }

    public function devices(string $id)
    {
        return $this->success($this->service->devices(AppUser::findOrFail($id)));
    }
}
