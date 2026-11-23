<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Permission;
use App\Services\Admin\PermissionService;
use Illuminate\Http\Request;

class PermissionController extends Controller
{
    public function __construct(private readonly PermissionService $service) {}

    public function index()
    {
        return $this->success($this->service->tree());
    }

    public function flat()
    {
        return $this->success($this->service->flat());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'parent_id' => ['nullable', 'integer'],
            'name' => ['required', 'string', 'max:64'],
            'code' => ['required', 'string', 'max:128', 'unique:permissions,code'],
            'type' => ['required', 'in:menu,action'],
            'path' => ['nullable', 'string', 'max:128'],
            'icon' => ['nullable', 'string', 'max:64'],
            'component_path' => ['nullable', 'string', 'max:255'],
            'sort' => ['nullable', 'integer'],
            'status' => ['nullable', 'integer', 'in:0,1'],
        ]);

        return $this->success($this->service->create($data), '创建成功');
    }

    public function update(Request $request, Permission $permission)
    {
        $data = $request->validate([
            'parent_id' => ['sometimes', 'integer'],
            'name' => ['sometimes', 'string', 'max:64'],
            'code' => ['sometimes', 'string', 'max:128', 'unique:permissions,code,'.$permission->id],
            'type' => ['sometimes', 'in:menu,action'],
            'path' => ['sometimes', 'nullable', 'string', 'max:128'],
            'icon' => ['sometimes', 'nullable', 'string', 'max:64'],
            'component_path' => ['sometimes', 'nullable', 'string', 'max:255'],
            'sort' => ['sometimes', 'integer'],
            'status' => ['sometimes', 'integer', 'in:0,1'],
        ]);

        return $this->success($this->service->update($permission, $data), '保存成功');
    }

    public function destroy(Permission $permission)
    {
        $this->service->destroy($permission);

        return $this->success(null, '已删除');
    }
}
