<?php

namespace App\Services\Admin;

use App\Models\Permission;
use App\Services\BaseService;
use Illuminate\Validation\ValidationException;

class PermissionService extends BaseService
{
    public function tree(): array
    {
        return $this->buildTree(Permission::query()->orderBy('sort')->orderBy('id')->get(), 0);
    }

    public function flat(): array
    {
        return Permission::query()->orderBy('sort')->orderBy('id')->get()->map(fn (Permission $p) => [
            'id' => $p->id,
            'parent_id' => (int) $p->parent_id,
            'name' => $p->name,
            'code' => $p->code,
            'type' => $p->type,
            'path' => $p->path,
            'icon' => $p->icon,
            'component_path' => $p->component_path,
            'sort' => (int) $p->sort,
            'status' => (int) $p->status,
        ])->all();
    }

    private function buildTree($items, int $parentId): array
    {
        $tree = [];
        foreach ($items as $item) {
            if ((int) $item->parent_id !== $parentId) {
                continue;
            }

            $tree[] = [
                'id' => $item->id,
                'parent_id' => (int) $item->parent_id,
                'name' => $item->name,
                'code' => $item->code,
                'type' => $item->type,
                'path' => $item->path,
                'icon' => $item->icon,
                'component_path' => $item->component_path,
                'sort' => (int) $item->sort,
                'status' => (int) $item->status,
                'children' => $this->buildTree($items, (int) $item->id),
            ];
        }

        return $tree;
    }

    public function create(array $data): Permission
    {
        return Permission::create([
            'parent_id' => (int) ($data['parent_id'] ?? 0),
            'name' => trim((string) $data['name']),
            'code' => trim((string) $data['code']),
            'type' => $data['type'] ?? 'action',
            'path' => (string) ($data['path'] ?? ''),
            'icon' => (string) ($data['icon'] ?? ''),
            'component_path' => (string) ($data['component_path'] ?? ''),
            'sort' => (int) ($data['sort'] ?? 0),
            'status' => (int) ($data['status'] ?? 1),
        ]);
    }

    public function update(Permission $permission, array $data): Permission
    {
        $fields = ['parent_id', 'name', 'code', 'type', 'path', 'icon', 'component_path', 'sort', 'status'];
        foreach ($fields as $field) {
            if (array_key_exists($field, $data)) {
                $permission->{$field} = $data[$field];
            }
        }
        $permission->save();

        return $permission->refresh();
    }

    public function destroy(Permission $permission): void
    {
        if (Permission::where('parent_id', $permission->id)->exists()) {
            throw ValidationException::withMessages(['id' => ['请先删除子权限']]);
        }

        $permission->roles()->detach();
        $permission->delete();
    }
}
