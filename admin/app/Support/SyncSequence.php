<?php

namespace App\Support;

use App\Models\AppUser;
use Illuminate\Support\Facades\DB;

class SyncSequence
{
    /**
     * 从 app_users.next_sync_seq 原子分配一段连续序号。
     * 返回起始序号；调用方按 0..count-1 递增使用。
     */
    public static function allocate(AppUser $user, int $count = 1): int
    {
        $count = max(1, $count);

        return DB::transaction(function () use ($user, $count) {
            /** @var AppUser $locked */
            $locked = AppUser::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();
            $start = max(1, (int) $locked->next_sync_seq);
            $locked->forceFill(['next_sync_seq' => $start + $count])->save();
            $user->setAttribute('next_sync_seq', $start + $count);

            return $start;
        });
    }
}
