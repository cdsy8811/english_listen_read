<?php

namespace App\Console\Commands;

use App\Services\Ai\TtsService;
use Illuminate\Console\Command;

class PruneTtsCache extends Command
{
    protected $signature = 'app:prune-tts';

    protected $description = '按容量上限清理最久未使用的 TTS 音频缓存';

    public function handle(TtsService $tts): int
    {
        $removed = $tts->prune();
        $this->info("已清理 {$removed} 个音频缓存。");

        return self::SUCCESS;
    }
}
