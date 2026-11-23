<?php

namespace App\Services\Ai;

use RuntimeException;
use WebSocket\Client;
use WebSocket\Message\Text;

class XfyunWebSocket
{
    public function __construct(private readonly XfyunSigner $signer) {}

    public function tts(string $text, string $lang, float $speed): string
    {
        $this->assertConfigured();

        $vcn = $lang === 'en'
            ? (string) config('xfyun.tts.vcn_en')
            : (string) config('xfyun.tts.vcn_zh');
        $xfSpeed = (int) round(min(2.0, max(0.5, $speed)) * 50);

        $body = [
            'header' => ['app_id' => (string) config('xfyun.app_id'), 'status' => 2],
            'parameter' => [
                'tts' => [
                    'vcn' => $vcn,
                    'speed' => $xfSpeed,
                    'volume' => 100,
                    'pitch' => 50,
                    'audio' => ['encoding' => 'lame', 'sample_rate' => 16000, 'channels' => 1, 'bit_depth' => 16],
                ],
            ],
            'payload' => [
                'text' => [
                    'encoding' => 'utf8',
                    'compress' => 'raw',
                    'format' => 'plain',
                    'status' => 2,
                    'seq' => 0,
                    'text' => base64_encode($text),
                ],
            ],
        ];

        $url = $this->signer->signedUrl((string) config('xfyun.tts.wss'), 'GET');
        $client = $this->connect($url);
        $frames = [];

        try {
            $client->send(new Text(json_encode($body, JSON_UNESCAPED_UNICODE)));

            for ($i = 0; $i < 600; $i++) {
                $frame = json_decode($client->receive()->getContent(), true);
                if (! is_array($frame)) {
                    continue;
                }

                $code = $frame['header']['code'] ?? null;
                if ($code !== null && (int) $code !== 0) {
                    throw new RuntimeException('合成失败（code='.$code.'）：'.($frame['header']['message'] ?? '发音人可能未授权'));
                }

                $audio = $frame['payload']['audio'] ?? [];
                if (! empty($audio['audio'])) {
                    $frames[] = ['seq' => (int) ($audio['seq'] ?? 0), 'audio' => (string) $audio['audio']];
                }

                if ((int) ($audio['status'] ?? 0) === 2) {
                    break;
                }
            }
        } finally {
            $client->close();
        }

        if (! $frames) {
            throw new RuntimeException('合成未返回音频');
        }

        usort($frames, fn ($a, $b) => $a['seq'] <=> $b['seq']);
        $binary = '';
        foreach ($frames as $frame) {
            $binary .= base64_decode($frame['audio'], true) ?: '';
        }

        if ($binary === '') {
            throw new RuntimeException('合成音频为空');
        }

        return $binary;
    }

    public function asr(string $audioBytes, string $lang): string
    {
        $this->assertConfigured();

        if (strlen($audioBytes) > (int) config('xfyun.asr.max_bytes')) {
            throw new RuntimeException('录音文件过大，请控制在 60 秒内');
        }

        $audioBase64 = base64_encode($audioBytes);
        $business = [
            'language' => $lang === 'en' ? 'en_us' : 'zh_cn',
            'domain' => 'iat',
            'eos' => 4000,
        ];
        if ($lang !== 'en') {
            $business['accent'] = 'mandarin';
        }

        $chunks = str_split($audioBase64, 2048) ?: [''];
        $last = count($chunks) - 1;
        $frames = [];
        foreach ($chunks as $index => $chunk) {
            $data = [
                'status' => $index === 0 ? 0 : 1,
                'format' => 'audio/mpeg',
                'encoding' => 'lame',
                'audio' => $chunk,
            ];
            $frames[] = $index === 0
                ? ['common' => ['app_id' => (string) config('xfyun.app_id')], 'business' => $business, 'data' => $data]
                : ['data' => $data];
            if ($index === $last) {
                $frames[] = ['data' => ['status' => 2, 'format' => 'audio/mpeg', 'encoding' => 'lame', 'audio' => '']];
            }
        }

        $url = $this->signer->signedUrl((string) config('xfyun.asr.wss'), 'GET');
        $client = $this->connect($url);
        $text = '';

        try {
            foreach ($frames as $frame) {
                $client->send(new Text(json_encode($frame, JSON_UNESCAPED_UNICODE)));
                usleep(20000);
            }

            for ($i = 0; $i < 600; $i++) {
                $response = json_decode($client->receive()->getContent(), true);
                if (! is_array($response)) {
                    continue;
                }

                $code = $response['code'] ?? $response['header']['code'] ?? null;
                if ($code !== null && (int) $code !== 0) {
                    throw new RuntimeException('听写失败（code='.$code.'）：'.($response['message'] ?? $response['header']['message'] ?? ''));
                }

                $data = $response['data'] ?? [];
                if (! empty($data['result']['ws']) && is_array($data['result']['ws'])) {
                    foreach ($data['result']['ws'] as $ws) {
                        foreach (($ws['cw'] ?? []) as $cw) {
                            $text .= (string) ($cw['w'] ?? '');
                        }
                    }
                }

                if ((int) ($data['status'] ?? 0) === 2) {
                    break;
                }
            }
        } finally {
            $client->close();
        }

        $text = trim($text);
        if ($text === '') {
            throw new RuntimeException('未识别到内容，请说得清楚些或改用输入框作答');
        }

        return $text;
    }

    private function connect(string $url): Client
    {
        $client = new Client($url);
        $client->setTimeout((int) config('xfyun.timeout', 90));

        return $client;
    }

    private function assertConfigured(): void
    {
        if (config('xfyun.app_id') === '' || config('xfyun.api_key') === '' || config('xfyun.api_secret') === '') {
            throw new RuntimeException('讯飞语音接口凭据未配置');
        }
    }
}
