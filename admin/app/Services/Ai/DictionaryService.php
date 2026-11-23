<?php

namespace App\Services\Ai;

use RuntimeException;

class DictionaryService
{
    public const DICT_SYSTEM = '你是英汉双解词典编写助手。只输出严格 JSON，不要解释、不要代码块。';

    public const GLOSS_SYSTEM = '你是英汉词典速查助手。只输出严格 JSON，不要解释、不要代码块。';

    public function __construct(private readonly XfyunHttp $http) {}

    /**
     * 英文词查完整词条；中文输入返回 6–8 个候选。
     */
    public function lookup(string $query): array
    {
        $query = trim($query);
        if ($query === '') {
            throw new RuntimeException('请输入要查询的英文单词或中文释义');
        }

        $isChinese = (bool) preg_match('/\p{Han}/u', $query);

        $messages = [
            ['role' => 'system', 'content' => self::DICT_SYSTEM],
            ['role' => 'user', 'content' => $isChinese ? $this->candidatePrompt($query) : $this->entryPrompt($query)],
        ];

        $data = $this->http->chatJson($messages, [
            'max_tokens' => 3000,
            'thinking' => 'disabled',
            'timeout' => 90,
        ]);

        if ($isChinese) {
            $items = $data['candidates'] ?? $data['items'] ?? (array_is_list($data) ? $data : []);

            return [
                'lang' => 'zh',
                'query' => $query,
                'candidates' => is_array($items) ? array_slice($items, 0, 10) : [],
            ];
        }

        $entry = $data['entry'] ?? $data;
        if (! is_array($entry) || empty($entry)) {
            throw new RuntimeException('词典没有返回有效释义，请换个词试试');
        }

        return [
            'lang' => 'en',
            'query' => $query,
            'entry' => $entry,
        ];
    }

    public function gloss(array $words): array
    {
        $words = array_values(array_unique(array_filter(array_map(
            fn ($w) => trim((string) $w),
            $words
        ))));

        if (! $words) {
            throw new RuntimeException('没有要速览的单词');
        }

        $messages = [
            ['role' => 'system', 'content' => self::GLOSS_SYSTEM],
            ['role' => 'user', 'content' => $this->glossPrompt($words)],
        ];

        $data = $this->http->chatJson($messages, [
            'max_tokens' => 1200,
            'thinking' => 'disabled',
            'timeout' => 60,
        ]);

        $items = $data['items'] ?? $data['words'] ?? (array_is_list($data) ? $data : []);

        return [
            'items' => is_array($items) ? array_slice($items, 0, 20) : [],
        ];
    }

    private function entryPrompt(string $query): string
    {
        return implode("\n", [
            "请为英文单词或短语“{$query}”编写一条英汉双解词典条目，只输出 JSON。",
            '格式：{"entry":{"word":"","base":"","phonetic_uk":"","phonetic_us":"","forms":[""],',
            '"senses":[{"pos":"","def_zh":"","def_en":"","examples":[{"en":"","zh":""}]}],',
            '"phrases":[{"en":"","zh":""}],"synonyms":[""],"antonyms":[""],"notes":""}}',
            '要求：',
            '1. word 写规范原形；若查询词是变形（running / children / went），word 还原为原形，base 也写原形；否则 base 留空。',
            '2. phonetic_uk / phonetic_us 写标准 IPA，用 /.../ 包裹，英式与美式分开；不确定就留空，不要编造。',
            '3. senses 按词性分组，最多 5 组；每组 1–3 条中文释义，def_zh 用简体中文、简洁准确，def_en 用不超过 15 个词的简单英文解释。',
            '4. 每组给 1–2 个例句：en 是自然英文（8–18 词），zh 是准确的中文翻译；例句要体现该词性下的典型用法。',
            '5. phrases 最多 6 条常用搭配；synonyms / antonyms 各最多 6 个单词；notes 可写用法提示或易混词，没有就留空。',
            '6. 只输出与查询词相关的内容，不要输出其他词条；无法确认的字段用空字符串或空数组。',
        ]);
    }

    private function candidatePrompt(string $query): string
    {
        return implode("\n", [
            "用户输入的中文是“{$query}”。请给出它最可能对应的英语单词，只输出 JSON。",
            '格式：{"candidates":[{"word":"","phonetic_us":"","pos":"","brief":""}]}',
            '要求：',
            '1. 给 6–8 个候选，按常用度从高到低排序；word 一律用原形。',
            '2. brief 是 20 字以内的中文简释（如“放弃；抛弃”），pos 用 v. / n. / adj. 等缩写。',
            '3. phonetic_us 写标准美式 IPA，用 /.../ 包裹；不确定留空。',
            '4. 只输出单词候选，不要输出例句或解释段落。',
        ]);
    }

    private function glossPrompt(array $words): string
    {
        return implode("\n", [
            '给出下列英文单词的词典速览，只输出 JSON：'.json_encode(array_values($words), JSON_UNESCAPED_UNICODE),
            '格式：{"items":[{"word":"","phonetic_us":"","brief":""}]}',
            '要求：',
            '1. 每个输入词输出一条，word 原样返回输入（是 walked / children 这类变形也保留原形拼写）。',
            '2. brief 只写 1–3 条最常用的简体中文释义，用「；」分隔，不超过 30 字；不要词性、不要例句、不要搭配。',
            '3. phonetic_us 写这个输入词实际读音的美式 IPA，用 /.../ 包裹；不确定留空，不要编造。',
            '4. 不要输出同义词、反义词、用法说明或任何解释性文字。',
        ]);
    }
}
