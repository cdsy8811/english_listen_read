<?php

namespace App\Support;

use App\Models\User;

class PermLib
{
    public static function checkPermission(?User $user, string $permissionCode): bool
    {
        if (! $user) {
            return false;
        }

        return $user->hasPermission($permissionCode);
    }
}
