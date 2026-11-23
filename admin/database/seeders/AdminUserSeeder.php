<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $password = (string) env('ADMIN_INIT_PASSWORD', '');

        if ($password === '') {
            $this->command?->warn('ADMIN_INIT_PASSWORD 为空，跳过管理员创建；请用 php artisan app:create-admin 创建。');

            return;
        }

        $admin = User::withTrashed()->updateOrCreate(
            ['username' => 'admin'],
            [
                'nickname' => '超级管理员',
                'password' => Hash::make($password),
                'status' => 1,
                'deleted_at' => null,
            ]
        );

        $superRole = Role::where('code', 'super_admin')->first();
        if ($superRole) {
            $admin->roles()->syncWithoutDetaching([$superRole->id]);
        }

        $this->command?->info('管理员 admin 已就绪。');
    }
}
