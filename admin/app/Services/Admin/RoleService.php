<?php

namespace App\Services\Admin;

use App\Models\Permission;
use App\Models\Role;
use App\Services\BaseService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class RoleService extends BaseService
{
    public function list(Request $request)
    {
        $query = Role::query()->withCount(['permissions', 'users']);

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(fn ($q) => $q->where('name', 'like', '%'.$keyword.'%')
                ->orWhere('code', 'like', '%'.$keyword.'%'));
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (Role $role) => $this->row($role));
    }

    public function all(): array
    {
        return Role::query()->orderBy('id')->get()->map(fn (Role $role) => $this->row($role))->all();
    }

    public function row(Role $role): array
    {
        return [
            'id' => $role->id,
            'name' => $role->name,
            'code' => $role->code,
            'description' => $role->description,
            'status' => (int) $role->status,
            'permissions_count' => (int) ($role->permissions_count ?? $role->permissions()->count()),
            'users_count' => (int) ($role->users_count ?? $role->users()->count()),
            'permission_ids' => $role->permissions()->pluck('permissions.id')->map(fn ($id) => (int) $id)->all(),
            'created_at' => $role->created_at?->format('Y-m-d H:i:s'),
        ];
    }

    public function create(array $data): Role
    {
        return Role::create([
            'name' => trim((string) $data['name']),
            'code' => trim((string) $data['code']),
            'description' => (string) ($data['description'] ?? ''),
            'status' => (int) ($data['status'] ?? 1),
        ]);
    }

    public function update(Role $role, array $data): Role
    {
        if ($role->code === 'super_admin' && isset($data['code']) && $data['code'] !== 'super_admin') {
            throw ValidationException::withMessages(['code' => ['超级管理员角色编码不可修改']]);
        }

        $role->fill([
            'name' => array_key_exists('name', $data) ? trim((string) $data['name']) : $role->name,
            'code' => array_key_exists('code', $data) ? trim((string) $data['code']) : $role->code,
            'description' => array_key_exists('description', $data) ? (string) $data['description'] : $role->description,
            'status' => array_key_exists('status', $data) ? (int) $data['status'] : $role->status,
        ])->save();

        return $role->refresh();
    }

    public function destroy(Role $role): void
    {
        if ($role->code === 'super_admin') {
            throw ValidationException::withMessages(['id' => ['超级管理员角色不可删除']]);
        }

        if ($role->users()->exists()) {
            throw ValidationException::withMessages(['id' => ['该角色下还有管理员，先解除绑定']]);
        }

        $role->permissions()->detach();
        $role->delete();
    }

    public function assignPermissions(Role $role, array $permissionIds): Role
    {
        $ids = Permission::query()->whereIn('id', array_filter($permissionIds))->pluck('id')->all();
        $role->permissions()->sync($ids);

        return $role->refresh();
    }
}
