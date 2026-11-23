<?php

namespace App\Services\Admin;

use App\Models\AiCallLog;
use App\Models\TtsAsset;
use App\Services\BaseService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class AiUsageService extends BaseService
{
    public function logs(Request $request)
    {
        $query = AiCallLog::query()->with('appUser:id,username,nickname');

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (AiCallLog $log) => [
            'id' => $log->id,
            'app_user_id' => $log->app_user_id,
            'app_user' => $log->appUser?->username,
            'capability' => $log->capability,
            'provider' => $log->provider,
            'model' => $log->model,
            'request_id' => $log->request_id,
            'input_units' => (int) $log->input_units,
            'output_units' => (int) $log->output_units,
            'latency_ms' => (int) $log->latency_ms,
            'status' => $log->status,
            'error_code' => $log->error_code,
            'error_message' => $log->error_message,
            'created_at' => $log->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function summary(): array
    {
        $today = now()->startOfDay();

        return [
            'total' => AiCallLog::count(),
            'today' => AiCallLog::where('created_at', '>=', $today)->count(),
            'errors' => AiCallLog::where('status', '!=', 'ok')->count(),
            'avg_latency_ms' => (int) round((float) AiCallLog::avg('latency_ms')),
            'by_capability' => AiCallLog::query()
                ->selectRaw('capability, COUNT(*) as total, SUM(CASE WHEN status != ? THEN 1 ELSE 0 END) as errors', ['ok'])
                ->groupBy('capability')
                ->orderByDesc('total')
                ->get()
                ->map(fn ($row) => [
                    'capability' => $row->capability,
                    'total' => (int) $row->total,
                    'errors' => (int) $row->errors,
                ])->all(),
        ];
    }

    public function ttsAssets(Request $request)
    {
        $query = TtsAsset::query();
        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (TtsAsset $asset) => [
            'id' => $asset->id,
            'hash' => $asset->hash,
            'lang' => $asset->lang,
            'vcn' => $asset->vcn,
            'speed' => (int) $asset->speed,
            'bytes' => (int) $asset->bytes,
            'hits' => (int) $asset->hits,
            'last_used_at' => $asset->last_used_at?->format('Y-m-d H:i:s'),
            'created_at' => $asset->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function ttsStats(): array
    {
        return [
            'files' => TtsAsset::count(),
            'bytes' => (int) TtsAsset::sum('bytes'),
            'hits' => (int) TtsAsset::sum('hits'),
            'limit_mb' => (int) config('xfyun.tts_cache_mb', 2048),
        ];
    }

    public function deleteTtsAsset(TtsAsset $asset): void
    {
        Storage::disk('local')->delete($asset->path);
        $asset->delete();
    }

    public function clearTtsAssets(): int
    {
        $count = 0;

        TtsAsset::query()->chunkById(200, function ($assets) use (&$count) {
            foreach ($assets as $asset) {
                Storage::disk('local')->delete($asset->path);
                $asset->delete();
                $count++;
            }
        });

        return $count;
    }
}
