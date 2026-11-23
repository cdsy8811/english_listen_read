<?php

namespace App\Services\Ai;

use App\Models\TtsAsset;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class TtsService
{
    public function __construct(private readonly XfyunWebSocket $ws) {}

    /**
     * @return array{bytes: string, hash: string, cached: bool, path: string, lang: string, vcn: string, speed: int}
     */
    public function synthesize(string $text, string $lang, float $speed): array
    {
        $text = trim($text);
        if ($text === '') {
            throw new RuntimeException('合成文本不能为空');
        }

        $lang = $lang === 'en' ? 'en' : 'zh';
        $vcn = $lang === 'en' ? (string) config('xfyun.tts.vcn_en') : (string) config('xfyun.tts.vcn_zh');
        $xfSpeed = (int) round(min(2.0, max(0.5, $speed)) * 50);
        $hash = hash('sha256', $text.'|'.$lang.'|'.$vcn.'|'.$xfSpeed);
        $path = 'tts/'.substr($hash, 0, 2).'/'.$hash.'.mp3';
        $disk = Storage::disk('local');

        $asset = TtsAsset::where('hash', $hash)->first();
        if ($asset && $disk->exists($asset->path)) {
            $asset->increment('hits');
            $asset->forceFill(['last_used_at' => now()])->save();

            return [
                'bytes' => $disk->get($asset->path),
                'hash' => $hash,
                'cached' => true,
                'path' => $asset->path,
                'lang' => $lang,
                'vcn' => $vcn,
                'speed' => $xfSpeed,
            ];
        }

        if ($asset) {
            $asset->delete();
        }

        try {
            $bytes = $this->ws->tts($text, $lang, $speed);
        } catch (RuntimeException $e) {
            throw $e;
        } catch (\Throwable $e) {
            logger()->warning('ai.tts.connection', ['class' => get_class($e)]);
            throw new RuntimeException('语音合成连接失败，请稍后重试');
        }

        $disk->put($path, $bytes);

        TtsAsset::updateOrCreate(
            ['hash' => $hash],
            [
                'lang' => $lang,
                'vcn' => $vcn,
                'speed' => $xfSpeed,
                'path' => $path,
                'bytes' => strlen($bytes),
                'hits' => 0,
                'last_used_at' => now(),
            ]
        );

        $this->prune();

        return [
            'bytes' => $bytes,
            'hash' => $hash,
            'cached' => false,
            'path' => $path,
            'lang' => $lang,
            'vcn' => $vcn,
            'speed' => $xfSpeed,
        ];
    }

    public function prune(): int
    {
        $limitBytes = max(0, (int) config('xfyun.tts_cache_mb', 2048)) * 1024 * 1024;
        if ($limitBytes === 0) {
            return 0;
        }

        $total = (int) TtsAsset::sum('bytes');
        if ($total <= $limitBytes) {
            return 0;
        }

        $removed = 0;
        $disk = Storage::disk('local');

        TtsAsset::query()->orderByRaw('COALESCE(last_used_at, created_at) asc')->chunkById(100, function ($assets) use (&$total, &$removed, $limitBytes, $disk) {
            foreach ($assets as $asset) {
                if ($total <= $limitBytes) {
                    return false;
                }
                $disk->delete($asset->path);
                $total -= (int) $asset->bytes;
                $asset->delete();
                $removed++;
            }

            return true;
        });

        return $removed;
    }
}
