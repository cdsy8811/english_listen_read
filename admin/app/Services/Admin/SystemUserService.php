<?php

namespace App\Services\Admin;

use App\Models\Role;
use App\Models\User;
use App\Services\BaseService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class SystemUserService extends BaseService
{
    public function list(Request $request)
    {
        $query = User::query()->with('roles:id,name,code');

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(fn ($q) => $q->where('username', 'like', '%'.$keyword.'%')
                ->orWhere('nickname', 'like', '%'.$keyword.'%'));
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (User $user) => $this->row($user));
    }

    public function row(User $user): array
    {
        return [
            'id' => $user->id,
            'username' => $user->username,
            'nickname' => $user->nickname,
            'email' => $user->email,
            'status' => (int) $user->status,
            'last_login_at' => $user->last_login_at?->format('Y-m-d H:i:s'),
            'last_login_ip' => $user->last_login_ip,
            'roles' => $user->roles->map(fn (Role $role) => [
                'id' => $role->id,
                'name' => $role->name,
                'code' => $role->code,
            ])->all(),
            'role_ids' => $user->roles->pluck('id')->map(fn ($id) => (int) $id)->all(),
            'created_at' => $user->created_at?->format('Y-m-d H:i:s'),
        ];
    }

    public function options(): array
    {
        return User::query()->where('status', 1)->orderBy('id')->get(['id', 'username', 'nickname'])
            ->map(fn (User $user) => [
                'id' => $user->id,
                'username' => $user->username,
                'nickname' => $user->nickname,
            ])->all();
    }

    public function create(array $data): User
    {
        $this->assertUsernameAvailable($data['username']);

        $user = User::create([
            'username' => trim((string) $data['username']),
            'nickname' => (string) ($data['nickname'] ?? ''),
            'email' => $data['email'] ?? null,
            'password' => Hash::make((string) $data['password']),
            'status' => (int) ($data['status'] ?? 1),
        ]);

        $this->syncRoles($user, $data['role_ids'] ?? []);

        return $user->load('roles');
    }

    public function update(User $operator, User $user, array $data): User
    {
        if (isset($data['username']) && $data['username'] !== $user->username) {
            $this->assertUsernameAvailable($data['username'], $user->id);
            $user->username = trim((string) $data['username']);
        }

        if (array_key_exists('nickname', $data)) {
            $user->nickname = (string) $data['nickname'];
        }

        if (array_key_exists('email', $data)) {
            $user->email = $data['email'];
        }

        if (array_key_exists('status', $data)) {
            if ((int) $data['status'] !== 1) {
                if ($user->id === $operator->id) {
                    throw ValidationException::withMessages(['status' => ['不能禁用当前登录账号']]);
                }
                if ($user->username === 'admin') {
                    throw ValidationException::withMessages(['status' => ['超级管理员不可禁用']]);
                }
                $user->tokens()->delete();
            }
            $user->status = (int) $data['status'];
        }

        if (! empty($data['password'])) {
            $user->password = Hash::make((string) $data['password']);
            $user->tokens()->delete();
        }

        $user->save();

        if (array_key_exists('role_ids', $data)) {
            $this->syncRoles($user, $data['role_ids'] ?? []);
        }

        return $user->refresh()->load('roles');
    }

    public function destroy(User $operator, User $user): void
    {
        if ($user->id === $operator->id) {
            throw ValidationException::withMessages(['id' => ['不能删除当前登录账号']]);
        }

        if ($user->username === 'admin') {
            throw ValidationException::withMessages(['id' => ['超级管理员不可删除']]);
        }

        $user->tokens()->delete();
        $user->delete();
    }

    public function resetPassword(User $user, string $password): void
    {
        $user->forceFill(['password' => Hash::make($password)])->save();
        $user->tokens()->delete();
    }

    private function syncRoles(User $user, array $roleIds): void
    {
        $ids = Role::query()->whereIn('id', array_filter($roleIds))->pluck('id')->all();
        $user->roles()->sync($ids);
    }

    private function assertUsernameAvailable(string $username, ?int $ignoreId = null): void
    {
        $username = trim($username);
        if (! preg_match('/^[A-Za-z0-9_.-]{2,64}$/', $username)) {
            throw ValidationException::withMessages(['username' => ['账号格式不正确']]);
        }

        $exists = User::withTrashed()->where('username', $username)
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages(['username' => ['该账号已存在']]);
        }
    }
}
