<?php

namespace App\Services\Ai;

use App\Support\Phonetic;

class EvaluationService
{
    private const THRESHOLDS = [
        'loose' => ['high' => 0.90, 'pass' => 0.60, 'distance' => 3],
        'normal' => ['high' => 0.95, 'pass' => 0.72, 'distance' => 2],
        'strict' => ['high' => 1.00, 'pass' => 0.85, 'distance' => 1],
    ];

    public function __construct(private readonly XfyunHttp $http) {}

    public function evaluate(array $input): array
    {
        $local = $this->localEvaluate($input);

        return $this->semanticEvaluate($input, $local);
    }

    public function evaluatePassage(string $expected, string $asrText): array
    {
        $local = $this->localPassageEvaluate($expected, $asrText);

        return $this->semanticPassageEvaluate($expected, $local);
    }

    public function localEvaluate(array $input): array
    {
        $mode = (string) $input['mode'];
        $word = $input['word'];
        $strictness = (string) ($input['strictness'] ?? 'normal');
        if (! in_array($strictness, ['loose', 'normal', 'strict'], true)) {
            $strictness = 'normal';
        }
        $t = self::THRESHOLDS[$strictness];
        $isEn = $mode === '2.2';
        $expected = $isEn ? (string) $word['word'] : (string) $word['translation'];
        $answer = trim((string) ($input['answer'] ?? $input['asr_text'] ?? ''));
        $normalizedExpected = $isEn ? $this->normalizeEn($expected) : $this->normalizeZh($expected);
        $normalizedAnswer = $isEn ? $this->normalizeEn($answer) : $this->normalizeZh($answer);
        $score = 0;
        $note = '';
        $said = ($input['input_type'] ?? 'input') === 'record' ? '转写' : '作答';

        if ($normalizedAnswer !== '') {
            if ($isEn) {
                $homo = $this->homophoneHit($expected, $answer);
                $compactSame = $normalizedAnswer !== $normalizedExpected
                    && $this->compactEn($expected) === $this->compactEn($answer);

                if ($homo !== '') {
                    $score = 100;
                    $note = "{$said}「{$homo}」与答案「{$normalizedExpected}」同音，按正确计";
                } elseif ($compactSame) {
                    $score = 100;
                    $note = "{$said}与答案只差词间空格，按正确计";
                } else {
                    $sim = $this->similarity($normalizedExpected, $normalizedAnswer);
                    $dist = $this->levenshtein($normalizedExpected, $normalizedAnswer);
                    $score = $sim >= $t['high'] ? 100
                        : ($sim >= $t['pass'] ? (int) round(60 + ($sim - $t['pass']) / ($t['high'] - $t['pass']) * 35)
                            : ($dist <= $t['distance'] ? (int) round(45 + (1 - $dist / ($t['distance'] + 1)) * 15) : 0));
                }
            } else {
                $cover = $this->meaningCoverage($expected, $answer);
                $sim = $this->similarity($normalizedExpected, $normalizedAnswer);
                $score = $cover >= 1 || $sim >= $t['high'] ? 100
                    : ($cover >= $t['pass'] ? (int) round(60 + $cover * 35)
                        : ($cover > 0 ? (int) round(35 + $cover * 30)
                            : ($sim >= 0.5 ? (int) round(40 + $sim * 30) : 0)));
            }
        }

        $feedback = $note !== '' ? "答对了：{$note}"
            : ($score >= 90 ? '答对了'
                : ($score >= 60 ? '基本正确，注意与标准答案的差异'
                    : ($score > 0 ? '还差一点，看看标准答案'
                        : ($answer !== '' ? '没有答对，可以重试或跳过' : '没有收到作答内容'))));

        return [
            'score' => $score,
            'highlights' => $isEn ? $this->highlightEn($expected, $answer) : $this->highlightZh($expected, $answer),
            'expected' => $expected,
            'answer' => $answer,
            'asrText' => (string) ($input['asr_text'] ?? ''),
            'feedback' => $feedback,
            'semantic' => false,
        ];
    }

    private function semanticEvaluate(array $input, array $local): array
    {
        if ($local['answer'] === '' || $local['score'] >= 100 || $local['score'] <= 0) {
            return $local;
        }

        $isEn = ($input['mode'] ?? '') === '2.2';
        $word = $input['word'];
        $messages = [
            [
                'role' => 'system',
                'content' => '你是英语练习的内容正确度判分助手。只输出严格 JSON：{"score":0-100,"reason":"简短中文说明"}。不要解释、不要代码块。只判断文字内容是否答对，不评价发音。'
                    .'注意：录音转写只给文字，可能把词写成同音词（英文 two→to、read→red；中文「放弃」→「放汽」）或把单词拆开/粘连（abandon→a band on）。'
                    .'这类与标准答案读音相同或拼写只差空格的转写要按正确给分；仅读音相近但不同的词（ship/sheep）不算对。',
            ],
            [
                'role' => 'user',
                'content' => $isEn
                    ? "题目：看中文释义说英文。\n标准答案：{$word['word']}\n中文释义：{$word['translation']}\n"
                        .'用户作答（'.(($input['input_type'] ?? '') === 'record' ? '录音转写' : '输入框')."）：{$local['answer']}\n"
                        ."本地文本比对得分：{$local['score']}（严格度 ".($input['strictness'] ?? 'normal')."）。\n"
                        .'请判断内容是否答对：拼写轻微误差、大小写、单复数、时态变化、同义单词可酌情给分；'
                        .'若转写只是标准答案的同音词或只差词间空格，给 100；完全无关给 0。'
                    : "题目：看英文说中文。\n英文单词：{$word['word']}\n标准中文释义：{$word['translation']}\n"
                        .'用户作答（'.(($input['input_type'] ?? '') === 'record' ? '录音转写' : '输入框')."）：{$local['answer']}\n"
                        ."本地关键词覆盖得分：{$local['score']}（严格度 ".($input['strictness'] ?? 'normal')."）。\n"
                        .'请判断中文意思是否答对：同义表述、近义词、只答出其中一个义项都算部分正确；'
                        .'转写里的同音错字按意思一致处理；无关内容给 0。',
            ],
        ];

        try {
            $verdict = $this->http->chatJson($messages, ['max_tokens' => 512, 'thinking' => 'disabled']);
        } catch (\Throwable $e) {
            logger()->warning('ai.evaluate.semantic.fallback', ['msg' => $e->getMessage()]);

            return $local;
        }

        if (! is_numeric($verdict['score'] ?? null)) {
            return $local;
        }

        $score = max(0, min(100, (int) round((float) $verdict['score'])));
        $local['score'] = max($local['score'], $score);
        $local['feedback'] = $score >= 90 ? '答对了' : ($score >= 60 ? '基本正确' : (string) ($verdict['reason'] ?? $local['feedback']));
        $local['semantic'] = true;

        return $local;
    }

    public function localPassageEvaluate(string $expected, string $asrText): array
    {
        $align = $this->alignPassage($expected, $asrText);
        $answer = trim($asrText);
        $base = $align['total'] > 0 ? min(1, $align['hit'] / $align['total']) : 0;
        $penalty = min(0.15, count($align['extra']) * 0.03);
        $score = (int) round($base * (1 - $penalty) * 100);
        $missed = count(array_filter($align['words'], fn ($w) => $w['status'] === 'missed'));

        return [
            'score' => $score,
            'expected' => $expected,
            'answer' => $answer,
            'asrText' => $answer,
            'words' => $align['words'],
            'extra' => $align['extra'],
            'hit' => $align['hit'],
            'total' => $align['total'],
            'feedback' => $this->passageFeedback($score, $missed, count($align['extra'])),
            'semantic' => false,
        ];
    }

    private function semanticPassageEvaluate(string $expected, array $local): array
    {
        if ($local['answer'] === '' || $local['score'] >= 100 || $local['score'] <= 0) {
            return $local;
        }

        $messages = [
            [
                'role' => 'system',
                'content' => '你是英语跟读的内容正确度判分助手。只输出严格 JSON：{"score":0-100,"reason":"简短中文说明"}。'
                    .'不要解释、不要代码块。只判断学生读出的词是否覆盖原文，不评价发音、语调或流利度。'
                    .'语音听写只给文字，可能把词写成同音词（two→to、read→red）、把缩写拆开（don\'t→don t）或漏掉虚词，'
                    .'这类转写误差要按内容对错合理给分；原文没有的词（多读）轻微扣分。',
            ],
            [
                'role' => 'user',
                'content' => "原文句子：{$expected}\n学生朗读的语音听写：{$local['answer']}\n"
                    ."本地逐词对齐得分：{$local['score']}（原句 {$local['total']} 词，对齐命中 {$local['hit']} 词）。\n"
                    .'请判断学生读出的内容是否覆盖原文：大部分词对上给 80-100；漏掉少量实词给 60-85；'
                    .'只对上一部分给 30-60；完全无关或没读到内容给 0。多读原文没有的词按轻微扣分处理。',
            ],
        ];

        try {
            $verdict = $this->http->chatJson($messages, ['max_tokens' => 512, 'thinking' => 'disabled']);
        } catch (\Throwable $e) {
            logger()->warning('ai.passage.semantic.fallback', ['msg' => $e->getMessage()]);

            return $local;
        }

        if (! is_numeric($verdict['score'] ?? null)) {
            return $local;
        }

        $score = max(0, min(100, (int) round((float) $verdict['score'])));
        $local['score'] = max($local['score'], $score);
        $local['feedback'] = $score >= 90 ? '内容读得完整' : (string) ($verdict['reason'] ?? $local['feedback']);
        $local['semantic'] = true;

        return $local;
    }

    private function alignPassage(string $expected, string $asrText): array
    {
        preg_match_all("/[A-Za-z0-9'’\\-]+/u", $expected, $m);
        $display = $m[0] ?? [];
        $exp = array_map(fn ($token) => $this->normalizeToken($token), $display);
        $ans = $this->answerTokens($asrText);
        $n = count($exp);
        $mm = count($ans);
        $total = $n;

        if ($n === 0) {
            return ['words' => [], 'extra' => $ans, 'hit' => 0, 'total' => 0];
        }

        if ($mm === 0) {
            return [
                'words' => array_map(fn ($text) => ['text' => $text, 'status' => 'missed'], $display),
                'extra' => [],
                'hit' => 0,
                'total' => $total,
            ];
        }

        $dp = array_fill(0, $n + 1, array_fill(0, $mm + 1, 0));
        for ($i = 1; $i <= $n; $i++) {
            for ($j = 1; $j <= $mm; $j++) {
                $best = max($dp[$i - 1][$j], $dp[$i][$j - 1]);
                if ($exp[$i - 1] === $ans[$j - 1]) {
                    $best = max($best, $dp[$i - 1][$j - 1] + 2);
                } elseif ($this->nearToken($exp[$i - 1], $ans[$j - 1])) {
                    $best = max($best, $dp[$i - 1][$j - 1] + 1);
                }
                $dp[$i][$j] = $best;
            }
        }

        $statuses = array_fill(0, $n, 'missed');
        $extra = [];
        $i = $n;
        $j = $mm;
        while ($i > 0 && $j > 0) {
            $cur = $dp[$i][$j];
            if ($exp[$i - 1] === $ans[$j - 1] && $cur === $dp[$i - 1][$j - 1] + 2) {
                $statuses[$i - 1] = 'ok';
                $i--;
                $j--;

                continue;
            }
            if ($this->nearToken($exp[$i - 1], $ans[$j - 1]) && $cur === $dp[$i - 1][$j - 1] + 1) {
                $statuses[$i - 1] = 'near';
                $i--;
                $j--;

                continue;
            }
            if ($cur === $dp[$i - 1][$j]) {
                $i--;

                continue;
            }
            $extra[] = $ans[$j - 1];
            $j--;
        }
        while ($j > 0) {
            $extra[] = $ans[--$j];
        }

        $hit = 0.0;
        foreach ($statuses as $status) {
            $hit += $status === 'ok' ? 1 : ($status === 'near' ? 0.85 : 0);
        }

        return [
            'words' => array_map(fn ($text, $idx) => ['text' => $text, 'status' => $statuses[$idx]], $display, array_keys($display)),
            'extra' => array_reverse($extra),
            'hit' => round($hit, 2),
            'total' => $total,
        ];
    }

    private function passageFeedback(int $score, int $missed, int $extra): string
    {
        if ($score >= 90 && $missed === 0) {
            return '读得很完整';
        }
        if ($score >= 75) {
            return $missed ? "大部分读对了，有 {$missed} 个词没读出来" : '读得比较完整，注意多读的词';
        }
        if ($score >= 50) {
            return $missed ? "漏读了 {$missed} 个词，对照标记再读一遍" : '有一半左右没对上，对照原文再读一遍';
        }
        if ($score > 0) {
            return '只读对了少部分，慢一点、逐词读';
        }

        return $extra ? '没有对上原文，可能是录音太短或环境太吵' : '没有识别到朗读内容，按住录音读完再松手';
    }

    private function normalizeToken(string $token): string
    {
        return trim(str_replace(['’', '‘'], "'", mb_strtolower($token)), " \t\n\r\0\x0B.,!?;:\"'()[]{}“”‘’");
    }

    private function answerTokens(string $text): array
    {
        $text = str_replace(['’', '‘'], "'", mb_strtolower($text));
        $text = preg_replace("/[^a-z0-9'\\- ]+/", ' ', $text) ?? '';
        $text = trim(preg_replace('/\s+/', ' ', $text) ?? '');

        return $text === '' ? [] : explode(' ', $text);
    }

    private function nearToken(string $a, string $b): bool
    {
        if ($a === '' || $b === '') {
            return false;
        }
        if ($a === $b) {
            return true;
        }
        if (Phonetic::isHomophone($a, $b)) {
            return true;
        }

        return mb_strlen($a) >= 4 && mb_strlen($b) >= 4 && $this->levenshtein($a, $b) <= 1;
    }

    public function normalizeEn(string $s): string
    {
        $s = Phonetic::expandNumbers($s);
        $s = mb_strtolower($s);
        $s = preg_replace("/[^a-z0-9'\\-\\s]/", ' ', $s) ?? '';
        $s = preg_replace('/\s+/', ' ', $s) ?? '';

        return trim($s);
    }

    private function compactEn(string $s): string
    {
        return preg_replace('/[^a-z0-9]/', '', $this->normalizeEn($s)) ?? '';
    }

    public function normalizeZh(string $s): string
    {
        return mb_strtolower(preg_replace('/[^\x{4e00}-\x{9fa5}a-zA-Z0-9]/u', '', $s) ?? '');
    }

    public function levenshtein(string $a, string $b): int
    {
        if ($a === $b) {
            return 0;
        }

        $a = mb_str_split($a);
        $b = mb_str_split($b);
        $n = count($a);
        $m = count($b);
        if ($n === 0) {
            return $m;
        }
        if ($m === 0) {
            return $n;
        }

        $prev = range(0, $m);
        for ($i = 1; $i <= $n; $i++) {
            $cur = [$i];
            for ($j = 1; $j <= $m; $j++) {
                $cur[$j] = min($prev[$j] + 1, $cur[$j - 1] + 1, $prev[$j - 1] + ($a[$i - 1] === $b[$j - 1] ? 0 : 1));
            }
            $prev = $cur;
        }

        return $prev[$m];
    }

    public function similarity(string $a, string $b): float
    {
        if ($a === '' && $b === '') {
            return 1.0;
        }
        $max = max(mb_strlen($a), mb_strlen($b));

        return $max > 0 ? 1 - $this->levenshtein($a, $b) / $max : 0.0;
    }

    private function splitMeanings(string $s): array
    {
        $parts = preg_split('/[；;，,、。\/｜|\s+或\s+]+/u', $s) ?: [];

        return array_values(array_filter(array_map(fn ($x) => $this->normalizeZh($x), $parts), fn ($x) => $x !== ''));
    }

    private function meaningCoverage(string $expected, string $answer): float
    {
        $meanings = $this->splitMeanings($expected);
        $a = $this->normalizeZh($answer);
        if (! $meanings || $a === '') {
            return 0.0;
        }

        $hit = 0;
        foreach ($meanings as $meaning) {
            if (str_contains($a, $meaning) || str_contains($meaning, $a) || $this->similarity($a, $meaning) >= 0.6) {
                $hit++;
            }
        }

        return $hit / count($meanings);
    }

    private function highlightEn(string $expected, string $answer): array
    {
        $exp = array_values(array_filter(explode(' ', $this->normalizeEn($expected))));
        $ans = array_values(array_filter(explode(' ', $this->normalizeEn($answer))));
        if (! $exp) {
            return [];
        }
        $compactSame = $this->compactEn($expected) === $this->compactEn($answer);

        return array_map(fn ($w) => [
            'text' => $w,
            'ok' => $compactSame || (bool) array_filter($ans, fn ($a) => $a === $w || Phonetic::isHomophone($w, $a)),
        ], $exp);
    }

    private function highlightZh(string $expected, string $answer): array
    {
        $a = $this->normalizeZh($answer);

        return array_map(fn ($m) => [
            'text' => $m,
            'ok' => $a !== '' && (str_contains($a, $m) || str_contains($m, $a)),
        ], $this->splitMeanings($expected));
    }

    private function homophoneHit(string $expected, string $answer): string
    {
        $exp = array_values(array_filter(explode(' ', $this->normalizeEn($expected))));
        $ans = array_values(array_filter(explode(' ', $this->normalizeEn($answer))));
        if (! $exp || ! $ans) {
            return '';
        }

        if (count($exp) === count($ans)) {
            $identical = true;
            foreach ($exp as $i => $e) {
                if ($e !== $ans[$i]) {
                    $identical = false;
                }
            }
            if (! $identical) {
                foreach ($exp as $i => $e) {
                    if (! Phonetic::isHomophone($e, $ans[$i])) {
                        return '';
                    }
                }

                return implode(' ', $ans);
            }

            return '';
        }

        if (count($exp) === 1) {
            foreach ($ans as $a) {
                if ($a !== $exp[0] && Phonetic::isHomophone($exp[0], $a)) {
                    return $a;
                }
            }
        }

        return '';
    }
}
