<?php

namespace App\Models;

class Permission extends BaseModel
{
    protected function casts(): array
    {
        return [
            'parent_id' => 'integer',
            'sort' => 'integer',
            'status' => 'integer',
        ];
    }

    public function roles()
    {
        return $this->belongsToMany(Role::class, 'role_permissions', 'permission_id', 'role_id')
            ->withTimestamps();
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('sort')->orderBy('id');
    }
}
