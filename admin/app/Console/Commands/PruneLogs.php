<?php

namespace App\Console\Commands;

use App\Models\AiCallLog;
use App\Models\LoginLog;
use App\Models\OperationLog;
use Illuminate\Console\Command;

class PruneLogs extends Command
{
    protected $signature = 'app:prune-logs {--days=90 : 保留天数}';

    protected $description = '清理过期的操作日志、登录日志与 AI 调用日志';

    public function handle(): int
    {
        $days = max(7, (int) $this->option('days'));
        $before = now()->subDays($days);

        $operation = OperationLog::where('created_at', '<', $before)->delete();
        $login = LoginLog::where('created_at', '<', $before)->delete();
        $ai = AiCallLog::where('created_at', '<', $before)->delete();

        $this->info("已清理操作日志 {$operation} 条、登录日志 {$login} 条、AI 日志 {$ai} 条。");

        return self::SUCCESS;
    }
}
