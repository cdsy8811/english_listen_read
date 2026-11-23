<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Services\Admin\RoleService;
use Illuminate\Http\Request;

class RoleController extends Controller
{
    public function __construct(private readonly RoleService $service) {}

    public function index(Request $request)
    {
        return $this->successPage($this->service->list($request));
    }

    public function options()
    {
        return $this->success($this->service->all());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:64'],
            'code' => ['required', 'string', 'max:64', 'unique:roles,code'],
            'description' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'integer', 'in:0,1'],
        ]);

        return $this->success($this->service->row($this->service->create($data)), '创建成功');
    }

    public function update(Request $request, Role $role)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:64'],
            'code' => ['sometimes', 'string', 'max:64', 'unique:roles,code,'.$role->id],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'status' => ['sometimes', 'integer', 'in:0,1'],
        ]);

        return $this->success($this->service->row($this->service->update($role, $data)), '保存成功');
    }

    public function destroy(Role $role)
    {
        $this->service->destroy($role);

        return $this->success(null, '已删除');
    }

    public function assignPermissions(Request $request, Role $role)
    {
        $data = $request->validate([
            'permission_ids' => ['required', 'array'],
            'permission_ids.*' => ['integer'],
        ]);

        return $this->success($this->service->row($this->service->assignPermissions($role, $data['permission_ids'])), '权限已更新');
    }
}
