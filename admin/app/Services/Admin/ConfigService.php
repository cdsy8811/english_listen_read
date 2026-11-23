<?php

namespace App\Services\Admin;

use App\Models\SystemConfig;
use App\Services\BaseService;
use Illuminate\Support\Facades\Cache;

class ConfigService extends BaseService
{
    public function all(): array
    {
        $groups = [];

        foreach (SystemConfig::query()->orderBy('group')->orderBy('id')->get() as $config) {
            $groups[$config->group][] = [
                'id' => $config->id,
                'key' => $config->key,
                'value' => $config->value,
                'group' => $config->group,
                'remark' => $config->remark,
            ];
        }

        return $groups;
    }

    public function updateMany(array $items): void
    {
        foreach ($items as $item) {
            if (empty($item['key'])) {
                continue;
            }

            SystemConfig::updateOrCreate(
                ['key' => (string) $item['key']],
                [
                    'value' => $item['value'] ?? '',
                    'group' => (string) ($item['group'] ?? 'basic'),
                    'remark' => (string) ($item['remark'] ?? ''),
                ]
            );
        }

        Cache::forget('system_configs');
    }

    public function publicBasic(): array
    {
        return [
            'site_name' => SystemConfig::getValue('site_name', '橙子英语'),
            'site_description' => SystemConfig::getValue('site_description', '英语听读 App 云端管理后台'),
        ];
    }
}
