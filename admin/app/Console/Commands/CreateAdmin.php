<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class CreateAdmin extends Command
{
    protected $signature = 'app:create-admin
        {username=admin : 管理员账号}
        {--password= : 密码；不传则交互输入}
        {--nickname=超级管理员 : 显示名称}';

    protected $description = '创建或重置后台管理员账号';

    public function handle(): int
    {
        $username = trim((string) $this->argument('username'));
        $password = (string) $this->option('password');

        if ($password === '') {
            $password = (string) $this->secret('请输入密码（至少 8 位）');
        }

        $validator = Validator::make([
            'username' => $username,
            'password' => $password,
        ], [
            'username' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9_.-]+$/'],
            'password' => ['required', 'string', 'min:8', 'max:64'],
        ]);

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $user = User::withTrashed()->updateOrCreate(
            ['username' => $username],
            [
                'nickname' => (string) $this->option('nickname'),
                'password' => Hash::make($password),
                'status' => 1,
                'deleted_at' => null,
            ]
        );

        $role = Role::where('code', 'super_admin')->first();
        if ($role) {
            $user->roles()->syncWithoutDetaching([$role->id]);
        }

        $this->info("管理员 {$username} 已就绪。");

        return self::SUCCESS;
    }
}
