<?php

namespace App\Console\Commands;

use App\Models\AppSetting;
use App\Models\PracticeRecord;
use App\Models\ReadArticle;
use App\Models\ReadRecord;
use App\Models\StudySession;
use App\Models\Unit;
use App\Models\Word;
use Illuminate\Console\Command;

class PruneTombstones extends Command
{
    protected $signature = 'app:prune-tombstones';

    protected $description = '清理超过保留期的软删除墓碑（超期设备需从 cursor=0 全量重拉）';

    public function handle(): int
    {
        $days = max(1, (int) config('sync.tombstone_days', 180));
        $before = now()->subDays($days);
        $count = 0;

        $models = [Unit::class, Word::class, PracticeRecord::class, ReadArticle::class, ReadRecord::class, StudySession::class, AppSetting::class];

        foreach ($models as $class) {
            $count += $class::onlyTrashed()->where('deleted_at', '<', $before)->forceDelete();
        }

        $this->info("已清理 {$count} 条过期墓碑（保留 {$days} 天）。");

        return self::SUCCESS;
    }
}
