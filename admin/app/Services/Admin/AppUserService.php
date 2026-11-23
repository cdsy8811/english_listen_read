<?php

namespace App\Services\Admin;

use App\Models\AppUser;
use App\Services\BaseService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AppUserService extends BaseService
{
    public function list(Request $request)
    {
        $query = AppUser::query()
            ->withCount(['devices', 'units', 'words', 'practiceRecords', 'studySessions']);

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(function ($builder) use ($keyword) {
                $builder->where('username', 'like', '%'.$keyword.'%')
                    ->orWhere('nickname', 'like', '%'.$keyword.'%')
                    ->orWhere('uuid', 'like', '%'.$keyword.'%');
            });
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (AppUser $user) => $this->row($user));
    }

    public function options(Request $request): array
    {
        $keyword = trim((string) $request->input('keyword', ''));
        $query = AppUser::query()->orderByDesc('id')->limit(100);

        if ($keyword !== '') {
            $query->where(fn ($q) => $q->where('username', 'like', '%'.$keyword.'%')
                ->orWhere('nickname', 'like', '%'.$keyword.'%'));
        }

        return $query->get(['id', 'uuid', 'username', 'nickname', 'status'])->toArray();
    }

    public function create(array $data): AppUser
    {
        $this->assertUsernameAvailable($data['username']);

        return AppUser::create([
            'uuid' => 'au_'.Str::lower((string) Str::ulid()),
            'username' => trim($data['username']),
            'nickname' => (string) ($data['nickname'] ?? ''),
            'password' => Hash::make((string) $data['password']),
            'status' => (int) ($data['status'] ?? 1),
            'next_sync_seq' => 1,
        ]);
    }

    public function update(AppUser $user, array $data): AppUser
    {
        if (isset($data['username']) && $data['username'] !== $user->username) {
            $this->assertUsernameAvailable($data['username'], $user->id);
            $user->username = trim((string) $data['username']);
        }

        if (array_key_exists('nickname', $data)) {
            $user->nickname = (string) $data['nickname'];
        }

        if (array_key_exists('status', $data)) {
            $user->status = (int) $data['status'];
            if ((int) $user->status !== 1) {
                $user->tokens()->delete();
            }
        }

        if (! empty($data['password'])) {
            $user->password = Hash::make((string) $data['password']);
            $user->tokens()->delete();
        }

        $user->save();

        return $user->refresh();
    }

    public function destroy(AppUser $user): void
    {
        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            $user->delete();
        });
    }

    public function resetPassword(AppUser $user, string $password): void
    {
        $user->forceFill(['password' => Hash::make($password)])->save();
        $user->tokens()->delete();
    }

    public function devices(AppUser $user): array
    {
        return $user->devices()->orderByDesc('last_seen_at')->get()->map(fn ($device) => [
            'id' => $device->id,
            'device_id' => $device->device_id,
            'name' => $device->name,
            'platform' => $device->platform,
            'app_version' => $device->app_version,
            'last_seen_at' => $device->last_seen_at?->format('Y-m-d H:i:s'),
            'last_ip' => $device->last_ip,
        ])->all();
    }

    public function overview(AppUser $user): array
    {
        return [
            'user' => $this->row($user->loadCount(['devices', 'units', 'words', 'practiceRecords', 'studySessions'])),
            'devices' => $this->devices($user),
            'recent_practice' => $user->practiceRecords()->orderByDesc('created_at_ms')->limit(10)->get()->map(fn ($r) => [
                'id' => $r->id,
                'uuid' => $r->uuid,
                'word_uuid' => $r->word_uuid,
                'mode' => $r->mode,
                'input_type' => $r->input_type,
                'score' => (int) $r->score,
                'created_at' => $r->created_at_ms,
            ])->all(),
            'recent_sessions' => $user->studySessions()->orderByDesc('created_at_ms')->limit(10)->get()->map(fn ($s) => [
                'id' => $s->id,
                'uuid' => $s->uuid,
                'kind' => $s->kind,
                'mode' => $s->mode,
                'title' => $s->title,
                'duration_sec' => (int) $s->duration_sec,
                'avg_score' => (int) $s->avg_score,
                'created_at' => $s->created_at_ms,
            ])->all(),
        ];
    }

    public function row(AppUser $user): array
    {
        return [
            'id' => $user->id,
            'uuid' => $user->uuid,
            'username' => $user->username,
            'nickname' => $user->nickname,
            'status' => (int) $user->status,
            'last_login_at' => $user->last_login_at?->format('Y-m-d H:i:s'),
            'last_login_ip' => $user->last_login_ip,
            'created_at' => $user->created_at?->format('Y-m-d H:i:s'),
            'devices_count' => (int) ($user->devices_count ?? 0),
            'units_count' => (int) ($user->units_count ?? 0),
            'words_count' => (int) ($user->words_count ?? 0),
            'records_count' => (int) ($user->practice_records_count ?? 0),
            'sessions_count' => (int) ($user->study_sessions_count ?? 0),
        ];
    }

    private function assertUsernameAvailable(string $username, ?int $ignoreId = null): void
    {
        $username = trim($username);

        if ($username === '' || ! preg_match('/^[A-Za-z0-9_.-]{2,64}$/', $username)) {
            throw ValidationException::withMessages([
                'username' => ['账号需为 2-64 位字母、数字、下划线、点或短横线'],
            ]);
        }

        $exists = AppUser::withTrashed()
            ->where('username', $username)
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'username' => ['该账号已存在'],
            ]);
        }
    }
}
