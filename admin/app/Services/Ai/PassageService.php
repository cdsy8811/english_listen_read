<?php

namespace App\Services\Ai;

use RuntimeException;

class PassageService
{
    private const BATCH_SIZE = 15;

    public const TRANSLATE_SYSTEM = '你是英语教材翻译助手。只输出严格 JSON，不要解释、不要代码块。';

    public function __construct(private readonly XfyunHttp $http) {}

    /**
     * 逐句翻译。按 15 句一批串行调用，输出长度可控。
     */
    public function translate(array $sentences): array
    {
        $sentences = array_values(array_map(fn ($s) => trim((string) $s), $sentences));
        $sentences = array_values(array_filter($sentences, fn ($s) => $s !== ''));

        if (! $sentences) {
            return [];
        }

        $out = [];
        foreach (array_chunk($sentences, self::BATCH_SIZE) as $batch) {
            $translations = $this->translateBatch($batch);
            array_push($out, ...$translations);
        }

        return $out;
    }

    private function translateBatch(array $sentences): array
    {
        $messages = [
            ['role' => 'system', 'content' => self::TRANSLATE_SYSTEM],
            ['role' => 'user', 'content' => $this->prompt($sentences)],
        ];

        $list = $this->runBatch($messages, count($sentences));
        if (count(array_filter($list, fn ($v) => $v !== '')) < count($sentences)) {
            $list = $this->runBatch($messages, count($sentences));
        }

        if (! array_filter($list, fn ($v) => $v !== '')) {
            throw new RuntimeException('翻译服务没有返回内容，请稍后重试');
        }

        return $list;
    }

    private function runBatch(array $messages, int $count): array
    {
        $data = $this->http->chatJson($messages, [
            'max_tokens' => 2000,
            'thinking' => 'disabled',
            'timeout' => 90,
        ]);

        $arr = $data['translations'] ?? $data['items'] ?? (array_is_list($data) ? $data : []);
        $out = [];
        for ($i = 0; $i < $count; $i++) {
            $out[] = $this->cleanZh($arr[$i] ?? '');
        }

        return $out;
    }

    private function prompt(array $sentences): string
    {
        $lines = [
            '把下面每一句英文翻译成自然、准确的简体中文，只输出 JSON。',
            '格式：{"translations":["第一句的中文","第二句的中文"]}',
            '要求：',
            '1. 严格按输入顺序输出，条目数量必须与输入句子数完全一致，一句一条。',
            '2. 每条只写中文译文，不要英文原文、不要序号、不要音标、不要解释。',
            '3. 译得自然通顺，符合中文表达习惯，不要逐词硬译；人名、地名前后保持一致。',
            '4. 每句译文不超过 120 字。',
            '输入句子：',
        ];

        foreach ($sentences as $index => $sentence) {
            $lines[] = ($index + 1).'. '.$sentence;
        }

        return implode("\n", $lines);
    }

    private function cleanZh(mixed $raw): string
    {
        if (! is_string($raw)) {
            return '';
        }

        $s = preg_replace('/^\s*\d{1,3}[.)、)]\s*/u', '', $raw) ?? $raw;
        $s = preg_replace('/^["“\'‘]+|["”\'’]+$/u', '', $s) ?? $s;
        $s = preg_replace('/\s+/', ' ', $s) ?? $s;

        return mb_substr(trim($s), 0, 300);
    }
}
