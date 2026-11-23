<?php

namespace App\Services\Ai;

use RuntimeException;

class ExtractionService
{
    public const SYSTEM = '你是英语单词表整理助手。只输出严格 JSON，不要解释、不要代码块。';

    public function __construct(private readonly XfyunHttp $http) {}

    public function extract(string $markdown): array
    {
        $markdown = trim($markdown);
        if ($markdown === '') {
            throw new RuntimeException('没有可抽取的文本');
        }

        $messages = [
            ['role' => 'system', 'content' => self::SYSTEM],
            ['role' => 'user', 'content' => $this->prompt($markdown)],
        ];

        $data = $this->http->chatJson($messages, [
            'max_tokens' => 4096,
            'thinking' => 'disabled',
            'timeout' => 120,
        ]);

        $items = $data['items'] ?? $data['words'] ?? [];
        if (! is_array($items) && is_string($data['content'] ?? null)) {
            $decoded = json_decode($data['content'], true);
            $items = $decoded['items'] ?? $decoded['words'] ?? [];
        }

        if (! is_array($items)) {
            throw new RuntimeException('模型没有返回词条数组');
        }

        return ['words' => $this->normalizeDrafts($items)];
    }

    private function prompt(string $markdown): string
    {
        return implode("\n", [
            '下面是从单词表图片 OCR 出来的 markdown 文本。请抽取每个词条，只输出 JSON，不要解释、不要代码块。',
            '格式：{"items":[{"word":"","phonetic":"","pos":"","translation":""}]}',
            '要求：',
            '1. OCR 会把 IPA 音标识别成方框 / LaTeX 公式等乱码，因此 phonetic 必须**完全忽略原文里的音标**，根据单词重新写出标准英式 IPA 音标，并用 /.../ 包裹。',
            '2. word 只保留英文单词本身（去掉序号、音标、词性、中文）；大小写按单词表惯例（一般小写）。',
            '3. pos 统一用词性缩写（v. / n. / adj. / adv. / prep. 等）；原文若带公式符号（如 v.$）一律去掉，只保留缩写；无法判断则留空。',
            '4. translation 只保留中文释义，去掉英文例句与音标；多个义项沿用原文标点（逗号就写逗号，别硬改成别的符号）。',
            '5. 每个词一条，不要合并、不要编造；不确定的字段留空字符串。',
            '6. OCR 常把右侧页码（如 40、41、48）粘在释义后面，或在释义中间插入空行把一句话断开：页码一律丢弃，被换行拆开的释义要接成一句完整的，不能截断。',
            '7. 像「## Unit 3」这样的标题、页码、页眉页脚、勾选记号（✓、T 等）都不是词条，不要输出。',
            '',
            'OCR 文本：',
            mb_substr($markdown, 0, 4000),
        ]);
    }

    public function normalizeDrafts(array $items): array
    {
        $out = [];
        $seen = [];

        foreach ($items as $raw) {
            if (! is_array($raw)) {
                continue;
            }

            $word = preg_replace('/^\d+[.、)]\s*/u', '', trim((string) ($raw['word'] ?? ''))) ?? '';
            $word = trim(preg_replace("/[^A-Za-z'\\-]/", '', $word) ?? '');
            if ($word === '') {
                continue;
            }

            $key = mb_strtolower($word);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            $out[] = [
                'word' => $word,
                'phonetic' => $this->cleanPhonetic((string) ($raw['phonetic'] ?? '')),
                'pos' => $this->cleanPos((string) ($raw['pos'] ?? '')),
                'translation' => trim((string) ($raw['translation'] ?? '')),
                'example' => trim((string) ($raw['example'] ?? '')),
            ];

            if (count($out) >= 500) {
                break;
            }
        }

        return $out;
    }

    private function cleanPos(string $raw): string
    {
        if ($raw === '') {
            return '';
        }

        $s = str_replace(['．', '。'], '.', trim($raw));
        $s = preg_replace('/\\\\?\$?square|□|☐|\\\\\$/iu', '', $s) ?? $s;
        $s = preg_replace('/\$[^A-Za-z]*$/', '', $s) ?? $s;
        $s = preg_replace('/[（(].*?[)）]/u', '', $s) ?? $s;
        $s = preg_replace('/[^A-Za-z.]/', '', $s) ?? $s;

        if (! preg_match('/(vt|vi|adj|adv|prep|pron|conj|int|num|art|aux|abbr|n|v)\.?/i', $s, $m)) {
            return '';
        }

        return strtolower($m[1]).'.';
    }

    private function cleanPhonetic(string $raw): string
    {
        if ($raw === '') {
            return '';
        }

        $s = trim($raw);
        if (preg_match('/[☐□$\\\\]|square/i', $s)) {
            return '';
        }
        if (! preg_match('#^/?(.+?)/?$#u', $s, $m)) {
            return '';
        }

        $inner = trim($m[1]);
        if ($inner === '' || mb_strlen($inner) > 40) {
            return '';
        }

        return '/'.$inner.'/';
    }
}
