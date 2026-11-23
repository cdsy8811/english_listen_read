<?php

namespace Database\Seeders;

use App\Models\SystemConfig;
use Illuminate\Database\Seeder;

class SystemConfigSeeder extends Seeder
{
    public function run(): void
    {
        $items = [
            ['key' => 'site_name', 'value' => '橙子英语', 'group' => 'basic', 'remark' => '后台与登录页标题'],
            ['key' => 'site_description', 'value' => '英语听读 App 云端管理后台', 'group' => 'basic', 'remark' => '站点副标题'],
            ['key' => 'ai_daily_quota', 'value' => (string) env('AI_DAILY_QUOTA', 500), 'group' => 'ai', 'remark' => '每用户每日 AI 调用上限，0 为不限'],
            ['key' => 'ai_ocr_max_mb', 'value' => '4', 'group' => 'ai', 'remark' => 'OCR 图片上限（MB）'],
            ['key' => 'ai_asr_max_seconds', 'value' => '60', 'group' => 'ai', 'remark' => '听写音频时长上限（秒）'],
            ['key' => 'app_min_version', 'value' => '1.0.0', 'group' => 'app', 'remark' => 'App 最低版本'],
            ['key' => 'sync_protocol_version', 'value' => '1', 'group' => 'sync', 'remark' => '同步协议版本'],
        ];

        foreach ($items as $item) {
            SystemConfig::updateOrCreate(['key' => $item['key']], $item);
        }
    }
}
