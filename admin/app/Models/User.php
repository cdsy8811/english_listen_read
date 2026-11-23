<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    protected $guarded = [];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'status' => 'integer',
            'last_login_at' => 'datetime',
        ];
    }

    public function roles()
    {
        return $this->belongsToMany(Role::class, 'user_roles', 'user_id', 'role_id')->withTimestamps();
    }

    public function isSuperAdmin(): bool
    {
        return $this->username === 'admin';
    }

    public function hasPermission(string $permissionCode): bool
    {
        if ($this->isSuperAdmin()) {
            return true;
        }

        return $this->roles()
            ->whereHas('permissions', function ($query) use ($permissionCode) {
                $query->where('code', $permissionCode)->where('status', 1);
            })
            ->exists();
    }

    public function getPermissionCodes(): array
    {
        if ($this->isSuperAdmin()) {
            return ['*'];
        }

        return $this->roles()->with('permissions:id,code')->get()
            ->pluck('permissions')->flatten()
            ->pluck('code')->unique()->values()->all();
    }

    public function getRolePayload(): array
    {
        return $this->roles()->get(['roles.id', 'roles.name', 'roles.code'])->toArray();
    }

    public function getMenus(): array
    {
        $query = Permission::query()
            ->where('type', 'menu')
            ->where('status', 1)
            ->orderBy('sort')
            ->orderBy('id');

        if (! $this->isSuperAdmin()) {
            $permissionIds = $this->roles()->with('permissions:id')->get()
                ->pluck('permissions')->flatten()->pluck('id')->unique()->all();
            $query->whereIn('id', $permissionIds);
        }

        return $this->buildMenuTree($query->get(), 0);
    }

    private function buildMenuTree($menus, int $parentId): array
    {
        $tree = [];

        foreach ($menus as $menu) {
            if ((int) $menu->parent_id !== $parentId) {
                continue;
            }

            $children = $this->buildMenuTree($menus, (int) $menu->id);
            $item = [
                'id' => $menu->id,
                'parent_id' => (int) $menu->parent_id,
                'name' => $menu->name,
                'code' => $menu->code,
                'path' => $menu->path,
                'icon' => $menu->icon,
                'component_path' => $menu->component_path,
                'sort' => (int) $menu->sort,
                'children' => $children,
            ];
            $tree[] = $item;
        }

        return $tree;
    }
}
