<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\TtsAsset;
use App\Services\Admin\AiUsageService;
use Illuminate\Http\Request;

class AiUsageController extends Controller
{
    public function __construct(private readonly AiUsageService $service) {}

    public function logs(Request $request)
    {
        return $this->successPage($this->service->logs($request));
    }

    public function summary()
    {
        return $this->success($this->service->summary());
    }

    public function ttsAssets(Request $request)
    {
        return $this->successPage($this->service->ttsAssets($request));
    }

    public function ttsStats()
    {
        return $this->success($this->service->ttsStats());
    }

    public function destroyTtsAsset(TtsAsset $asset)
    {
        $this->service->deleteTtsAsset($asset);

        return $this->success(null, '已删除');
    }

    public function clearTtsAssets()
    {
        return $this->success(['deleted' => $this->service->clearTtsAssets()], '缓存已清空');
    }
}
