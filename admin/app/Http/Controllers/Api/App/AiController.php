<?php

namespace App\Http\Controllers\Api\App;

use App\Http\Controllers\Controller;
use App\Models\AiCallLog;
use App\Models\SystemConfig;
use App\Services\Ai\DictionaryService;
use App\Services\Ai\EvaluationService;
use App\Services\Ai\ExtractionService;
use App\Services\Ai\PassageService;
use App\Services\Ai\TtsService;
use App\Services\Ai\XfyunHttp;
use App\Services\Ai\XfyunWebSocket;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Throwable;

class AiController extends Controller
{
    public function __construct(
        private readonly XfyunHttp $http,
        private readonly XfyunWebSocket $ws,
        private readonly ExtractionService $extraction,
        private readonly EvaluationService $evaluation,
        private readonly DictionaryService $dictionary,
        private readonly PassageService $passage,
        private readonly TtsService $tts,
    ) {}

    public function ocr(Request $request)
    {
        $data = $request->validate([
            'image' => ['nullable', 'file', 'max:4096', 'mimes:jpg,jpeg,png,webp'],
            'image_base64' => ['nullable', 'string'],
            'encoding' => ['nullable', 'in:jpg,jpeg,png,webp'],
        ]);

        if ($request->hasFile('image')) {
            $file = $data['image'];
            $binary = file_get_contents($file->getRealPath()) ?: '';
            $encoding = match (strtolower($file->extension() ?: 'jpg')) {
                'png' => 'png',
                'webp' => 'webp',
                default => 'jpg',
            };
        } else {
            $base64 = trim((string) ($data['image_base64'] ?? ''));
            if ($base64 === '') {
                throw ValidationException::withMessages(['image' => ['缺少图片：请上传 image 或传 image_base64']]);
            }
            $binary = base64_decode($base64, true);
            if ($binary === false) {
                throw new RuntimeException('image_base64 不是有效的 base64');
            }
            $encoding = (string) ($data['encoding'] ?? 'jpg');
            $encoding = in_array($encoding, ['jpg', 'jpeg', 'png', 'webp'], true) ? $encoding : 'jpg';
        }

        return $this->run('ocr', $request, strlen($binary), function () use ($binary, $encoding) {
            return $this->success([
                'markdown' => $this->http->ocr(base64_encode($binary), $encoding),
            ]);
        });
    }

    public function extract(Request $request)
    {
        $data = $request->validate([
            'markdown' => ['required', 'string', 'max:30000'],
        ]);

        return $this->run('extract', $request, mb_strlen($data['markdown']), function () use ($data) {
            return $this->success($this->extraction->extract($data['markdown']));
        });
    }

    public function evaluate(Request $request)
    {
        $data = $request->validate([
            'mode' => ['required', 'in:2.2,2.3'],
            'word' => ['required', 'array'],
            'word.word' => ['required', 'string', 'max:128'],
            'word.translation' => ['required', 'string', 'max:500'],
            'answer' => ['nullable', 'string', 'max:1000'],
            'asr_text' => ['nullable', 'string', 'max:2000'],
            'input_type' => ['nullable', 'in:record,input,mastered'],
            'strictness' => ['nullable', 'in:loose,normal,strict'],
        ]);

        return $this->run('evaluate', $request, mb_strlen((string) ($data['answer'] ?? '')), function () use ($data) {
            return $this->success($this->evaluation->evaluate($data));
        });
    }

    public function dict(Request $request)
    {
        $data = $request->validate([
            'query' => ['required', 'string', 'max:64'],
        ]);

        return $this->run('dict', $request, mb_strlen($data['query']), function () use ($data) {
            return $this->success($this->dictionary->lookup($data['query']));
        });
    }

    public function gloss(Request $request)
    {
        $data = $request->validate([
            'words' => ['required', 'array', 'min:1', 'max:10'],
            'words.*' => ['required', 'string', 'max:64'],
        ]);

        return $this->run('gloss', $request, count($data['words']), function () use ($data) {
            return $this->success($this->dictionary->gloss($data['words']));
        });
    }

    public function tts(Request $request)
    {
        $data = $request->validate([
            'text' => ['required', 'string', 'max:500'],
            'lang' => ['required', 'in:zh,en'],
            'speed' => ['nullable', 'numeric', 'min:0.5', 'max:2'],
        ]);

        $started = microtime(true);
        $speed = (float) ($data['speed'] ?? 1.0);
        $quota = $this->quotaResponse($request);
        if ($quota) {
            return $quota;
        }

        try {
            $result = $this->tts->synthesize($data['text'], $data['lang'], $speed);
        } catch (Throwable $e) {
            $this->log('tts', $request, mb_strlen($data['text']), 'error', $started, $e);

            throw $e;
        }

        $this->log('tts', $request, mb_strlen($data['text']), 'ok', $started, null, strlen($result['bytes']));

        $etag = '"'.$result['hash'].'"';
        if ($request->header('If-None-Match') === $etag) {
            return response('', 304)->header('ETag', $etag)->header('X-Cache', $result['cached'] ? 'HIT' : 'MISS');
        }

        return response($result['bytes'], 200, [
            'Content-Type' => 'audio/mpeg',
            'Content-Length' => (string) strlen($result['bytes']),
            'ETag' => $etag,
            'X-Cache' => $result['cached'] ? 'HIT' : 'MISS',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    public function asr(Request $request)
    {
        $data = $request->validate([
            'audio' => ['nullable', 'file', 'max:4096', 'mimes:mp3,mpeg,wav,ogg,m4a,mp4,webm'],
            'audio_base64' => ['nullable', 'string'],
            'lang' => ['nullable', 'in:zh,en'],
        ]);

        if ($request->hasFile('audio')) {
            $binary = file_get_contents($data['audio']->getRealPath()) ?: '';
        } else {
            $base64 = trim((string) ($data['audio_base64'] ?? ''));
            if ($base64 === '') {
                throw ValidationException::withMessages(['audio' => ['缺少音频：请上传 audio 或传 audio_base64']]);
            }
            $binary = base64_decode($base64, true);
            if ($binary === false) {
                throw new RuntimeException('audio_base64 不是有效的 base64');
            }
        }

        $lang = $data['lang'] ?? 'en';

        return $this->run('asr', $request, strlen($binary), function () use ($binary, $lang) {
            return $this->success([
                'text' => $this->ws->asr($binary, $lang),
            ]);
        });
    }

    public function passageTranslate(Request $request)
    {
        $data = $request->validate([
            'sentences' => ['required', 'array', 'min:1', 'max:60'],
            'sentences.*' => ['required', 'string', 'max:500'],
        ]);

        return $this->run('passage_translate', $request, count($data['sentences']), function () use ($data) {
            return $this->success(['translations' => $this->passage->translate($data['sentences'])]);
        });
    }

    public function passageEvaluate(Request $request)
    {
        $data = $request->validate([
            'expected' => ['required', 'string', 'max:500'],
            'asr_text' => ['nullable', 'string', 'max:2000'],
        ]);

        return $this->run('passage_evaluate', $request, mb_strlen($data['expected']), function () use ($data) {
            return $this->success($this->evaluation->evaluatePassage($data['expected'], (string) ($data['asr_text'] ?? '')));
        });
    }

    private function run(string $capability, Request $request, int $inputUnits, callable $callback)
    {
        $quota = $this->quotaResponse($request);
        if ($quota) {
            return $quota;
        }

        $started = microtime(true);

        try {
            $response = $callback();
            $this->log($capability, $request, $inputUnits, 'ok', $started);

            return $response;
        } catch (Throwable $e) {
            $this->log($capability, $request, $inputUnits, 'error', $started, $e);

            throw $e;
        }
    }

    private function quotaResponse(Request $request)
    {
        $user = $request->user();
        $quota = (int) SystemConfig::getValue('ai_daily_quota', config('xfyun.daily_quota', 0));

        if ($quota <= 0) {
            return null;
        }

        $used = AiCallLog::where('app_user_id', $user?->id)
            ->where('created_at', '>=', now()->startOfDay())
            ->count();

        if ($used < $quota) {
            return null;
        }

        $retryAfter = max(60, now()->endOfDay()->timestamp - time());

        return response()->json([
            'code' => 4029,
            'msg' => '今日 AI 调用已达上限，请明天再试',
            'data' => ['retry_after' => $retryAfter],
            'timestamp' => time(),
        ], 429, ['Retry-After' => (string) $retryAfter]);
    }

    private function log(string $capability, Request $request, int $inputUnits, string $status, float $started, ?Throwable $error = null, int $outputUnits = 0): void
    {
        try {
            AiCallLog::create([
                'app_user_id' => $request->user()?->id,
                'capability' => $capability,
                'provider' => 'xfyun',
                'model' => (string) config('xfyun.maas.model'),
                'request_id' => '',
                'input_units' => $inputUnits,
                'output_units' => $outputUnits,
                'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                'status' => $status,
                'error_code' => $error ? (string) $error->getCode() : '',
                'error_message' => $error ? mb_substr($error->getMessage(), 0, 500) : null,
                'ip' => (string) $request->ip(),
                'created_at' => now(),
            ]);
        } catch (Throwable) {
            // 日志失败不影响主流程
        }
    }
}
