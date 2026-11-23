<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class XfyunHttp
{
    public function __construct(private readonly XfyunSigner $signer) {}

    /**
     * 通用文档识别：图片 base64 → markdown 文本。
     */
    public function ocr(string $imageBase64, string $encoding = 'jpg'): string
    {
        $this->assertConfigured();

        if (strlen($imageBase64) > (int) config('xfyun.ocr.max_bytes')) {
            throw new RuntimeException('图片过大，请先压缩后再识别');
        }

        $url = $this->signer->signedUrl(
            (string) config('xfyun.ocr.url'),
            'POST',
            (string) config('xfyun.ocr.sign_host')
        );

        $body = [
            'header' => ['app_id' => (string) config('xfyun.app_id'), 'status' => 0],
            'parameter' => [
                'ocr' => [
                    'result_option' => 'normal',
                    'result_format' => 'json,markdown',
                    'output_type' => 'one_shot',
                    'rotation_min_angle' => 5,
                    'result' => ['encoding' => 'utf8', 'compress' => 'raw', 'format' => 'plain'],
                ],
            ],
            'payload' => [
                'image' => ['encoding' => $encoding, 'image' => $imageBase64, 'status' => 0, 'seq' => 0],
            ],
        ];

        $started = microtime(true);
        try {
            $response = Http::retry(2, 500)->timeout((int) config('xfyun.timeout'))->acceptJson()->post($url, $body);
        } catch (\Throwable $e) {
            logger()->warning('ai.ocr.http', ['class' => get_class($e)]);
            throw new RuntimeException('识别服务请求失败，请稍后重试');
        }
        $json = $response->json() ?? [];
        $header = $json['header'] ?? [];
        $code = $header['code'] ?? null;

        logger()->info('ai.ocr', [
            'status' => $response->status(),
            'code' => $code,
            'kb' => (int) round(strlen($imageBase64) / 1024),
            'ms' => (int) round((microtime(true) - $started) * 1000),
        ]);

        if ($code !== 0) {
            throw new RuntimeException('识别失败（code='.($code ?? '?').'）：'.($header['message'] ?? '未知原因'));
        }

        $result = $json['payload']['result'] ?? [];
        $text = (string) ($result['text'] ?? '');
        if ($text === '') {
            throw new RuntimeException('识别结果为空');
        }

        if (($result['compress'] ?? '') === 'gzip') {
            $decoded = @gzdecode(base64_decode($text));
            if ($decoded === false) {
                throw new RuntimeException('识别结果解压失败');
            }
        } else {
            $decoded = base64_decode($text, true);
            if ($decoded === false) {
                throw new RuntimeException('识别结果解码失败');
            }
        }

        return $this->pickDocumentText($decoded);
    }

    private function pickDocumentText(string $decoded): string
    {
        $obj = json_decode($decoded, true);
        if (is_array($obj) && ! empty($obj['document']) && is_array($obj['document'])) {
            $docs = array_values(array_filter($obj['document'], fn ($d) => is_array($d) && is_string($d['value'] ?? null)));
            $markdown = array_values(array_filter($docs, fn ($d) => ($d['name'] ?? '') === 'markdown'));
            $chosen = $markdown ?: $docs;
            $text = implode("\n", array_map(fn ($d) => (string) $d['value'], $chosen));
            if (trim($text) !== '') {
                return $text;
            }
        }

        return $decoded;
    }

    /**
     * Spark X2.6（OpenAI 兼容）聊天。
     */
    public function chat(array $messages, array $options = []): string
    {
        $this->assertMaasConfigured();

        $url = rtrim((string) config('xfyun.maas.base_url'), '/').'/chat/completions';
        $body = [
            'model' => (string) config('xfyun.maas.model'),
            'messages' => $messages,
            'stream' => false,
            'temperature' => $options['temperature'] ?? 0.1,
            'max_tokens' => $options['max_tokens'] ?? 1024,
        ];

        if (! empty($options['thinking'])) {
            $body['thinking'] = ['type' => $options['thinking']];
        }

        $started = microtime(true);
        try {
            $response = Http::retry(2, 500)
                ->timeout((int) ($options['timeout'] ?? config('xfyun.timeout')))
                ->withToken((string) config('xfyun.maas.api_key'))
                ->acceptJson()
                ->post($url, $body);
        } catch (\Throwable $e) {
            logger()->warning('ai.chat.http', ['class' => get_class($e)]);
            throw new RuntimeException('模型服务请求失败，请稍后重试');
        }

        $json = $response->json() ?? [];
        $choice = $json['choices'][0] ?? null;
        $content = $choice['message']['content'] ?? null;

        logger()->info('ai.chat', [
            'status' => $response->status(),
            'chars' => is_string($content) ? strlen($content) : 0,
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'model' => (string) config('xfyun.maas.model'),
        ]);

        if (! empty($json['error'])) {
            throw new RuntimeException('模型服务返回错误：'.($json['error']['message'] ?? '未知'));
        }

        if (! is_string($content) || trim($content) === '') {
            $finish = $choice['finish_reason'] ?? '';
            throw new RuntimeException('模型未返回内容'.($finish ? "（finish_reason={$finish}）" : ''));
        }

        return $content;
    }

    public function chatJson(array $messages, array $options = []): array
    {
        $content = $this->chat($messages, $options);
        $cleaned = trim($content);
        $cleaned = preg_replace('/^```(?:json)?\s*/i', '', $cleaned) ?? $cleaned;
        $cleaned = preg_replace('/\s*```$/', '', $cleaned) ?? $cleaned;
        $decoded = json_decode($cleaned, true);

        if (! is_array($decoded)) {
            throw new RuntimeException('模型返回的不是有效 JSON');
        }

        return $decoded;
    }

    private function assertConfigured(): void
    {
        if (config('xfyun.app_id') === '' || config('xfyun.api_key') === '' || config('xfyun.api_secret') === '') {
            throw new RuntimeException('讯飞私有接口凭据未配置');
        }
    }

    private function assertMaasConfigured(): void
    {
        if (config('xfyun.maas.api_key') === '') {
            throw new RuntimeException('讯飞 MaaS 凭据未配置');
        }
    }
}
