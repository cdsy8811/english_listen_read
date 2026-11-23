<?php

namespace App\Models;

class Role extends BaseModel
{
    protected function casts(): array
    {
        return [
            'status' => 'integer',
        ];
    }

    public function permissions()
    {
        return $this->belongsToMany(Permission::class, 'role_permissions', 'role_id', 'permission_id')
            ->withTimestamps();
    }

    public function users()
    {
        return $this->belongsToMany(User::class, 'user_roles', 'role_id', 'user_id')
            ->withTimestamps();
    }
}
