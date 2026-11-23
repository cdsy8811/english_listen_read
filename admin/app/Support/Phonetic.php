<?php

namespace App\Support;

class Phonetic
{
    private const GROUPS = [
        ['right', 'write', 'rite', 'wright'],
        ['red', 'read'],
        ['reed', 'read'],
        ['to', 'too', 'two'],
        ['there', 'their', 'theyre'],
        ['hear', 'here'],
        ['see', 'sea'],
        ['meet', 'meat'],
        ['week', 'weak'],
        ['way', 'weigh', 'whey'],
        ['sun', 'son'],
        ['by', 'buy', 'bye'],
        ['no', 'know'],
        ['new', 'knew', 'gnu'],
        ['one', 'won'],
        ['our', 'hour'],
        ['piece', 'peace'],
        ['break', 'brake'],
        ['dear', 'deer'],
        ['fair', 'fare'],
        ['hair', 'hare'],
        ['pair', 'pear'],
        ['plain', 'plane'],
        ['road', 'rode', 'rowed'],
        ['sail', 'sale'],
        ['tail', 'tale'],
        ['whole', 'hole'],
        ['wood', 'would'],
        ['blue', 'blew'],
        ['flour', 'flower'],
        ['aloud', 'allowed'],
        ['board', 'bored'],
        ['ceiling', 'sealing'],
        ['cereal', 'serial'],
        ['choose', 'chews'],
        ['cite', 'site', 'sight'],
        ['die', 'dye'],
        ['doe', 'dough'],
        ['feet', 'feat'],
        ['find', 'fined'],
        ['for', 'four', 'fore'],
        ['great', 'grate'],
        ['groan', 'grown'],
        ['hall', 'haul'],
        ['heal', 'heel'],
        ['heard', 'herd'],
        ['hire', 'higher'],
        ['need', 'knead'],
        ['not', 'knot'],
        ['nose', 'knows'],
        ['led', 'lead'],
        ['lesson', 'lessen'],
        ['loan', 'lone'],
        ['made', 'maid'],
        ['mail', 'male'],
        ['missed', 'mist'],
        ['none', 'nun'],
        ['or', 'oar', 'ore'],
        ['passed', 'past'],
        ['rain', 'reign', 'rein'],
        ['rose', 'rows'],
        ['scene', 'seen'],
        ['so', 'sew', 'sow'],
        ['stair', 'stare'],
        ['steal', 'steel'],
        ['sweet', 'suite'],
        ['some', 'sum'],
        ['through', 'threw'],
        ['toe', 'tow'],
        ['vain', 'vein', 'vane'],
        ['war', 'wore'],
        ['wear', 'where', 'ware'],
        ['which', 'witch'],
        ['your', 'youre', 'yore'],
        ['bare', 'bear'],
        ['beat', 'beet'],
        ['berry', 'bury'],
        ['cell', 'sell'],
        ['cent', 'scent', 'sent'],
        ['chord', 'cord'],
        ['climb', 'clime'],
        ['council', 'counsel'],
        ['current', 'currant'],
        ['days', 'daze'],
        ['earn', 'urn'],
        ['eight', 'ate'],
        ['eye', 'i'],
        ['fir', 'fur'],
        ['flew', 'flu', 'flue'],
        ['gate', 'gait'],
        ['genes', 'jeans'],
        ['guest', 'guessed'],
        ['in', 'inn'],
        ['knight', 'night'],
        ['leak', 'leek'],
        ['might', 'mite'],
        ['miner', 'minor'],
        ['morning', 'mourning'],
        ['muscle', 'mussel'],
        ['pact', 'packed'],
        ['pain', 'pane'],
        ['pause', 'paws'],
        ['peak', 'peek', 'pique'],
        ['pedal', 'peddle'],
        ['peer', 'pier'],
        ['plum', 'plumb'],
        ['pray', 'prey'],
        ['queue', 'cue'],
        ['quay', 'key'],
        ['rap', 'wrap'],
        ['rest', 'wrest'],
        ['ring', 'wring'],
        ['role', 'roll'],
        ['root', 'route'],
        ['rough', 'ruff'],
        ['seam', 'seem'],
        ['side', 'sighed'],
        ['sign', 'sine'],
        ['slay', 'sleigh'],
        ['soar', 'sore'],
        ['sole', 'soul'],
        ['stake', 'steak'],
        ['stationary', 'stationery'],
        ['straight', 'strait'],
        ['team', 'teem'],
        ['throne', 'thrown'],
        ['tide', 'tied'],
        ['time', 'thyme'],
        ['vale', 'veil'],
        ['waive', 'wave'],
        ['warn', 'worn'],
        ['whine', 'wine'],
        ['yoke', 'yolk'],
        ['you', 'ewe'],
        ['weight', 'wait'],
        ['whether', 'weather'],
        ['whose', 'whos'],
        ['colonel', 'kernel'],
        ['ok', 'okay', 'okey'],
    ];

    private const NUMBERS = [
        '0' => 'zero', '1' => 'one', '2' => 'two', '3' => 'three', '4' => 'four',
        '5' => 'five', '6' => 'six', '7' => 'seven', '8' => 'eight', '9' => 'nine',
        '10' => 'ten', '11' => 'eleven', '12' => 'twelve', '13' => 'thirteen',
        '14' => 'fourteen', '15' => 'fifteen', '16' => 'sixteen', '17' => 'seventeen',
        '18' => 'eighteen', '19' => 'nineteen', '20' => 'twenty', '30' => 'thirty',
        '40' => 'forty', '50' => 'fifty', '60' => 'sixty', '70' => 'seventy',
        '80' => 'eighty', '90' => 'ninety', '100' => 'hundred', '1000' => 'thousand',
    ];

    private static ?array $groupOf = null;

    public static function word(string $value): string
    {
        $value = mb_strtolower($value);
        $value = str_replace(["'", '’'], '', $value);

        return preg_replace('/[^a-z0-9]/', '', $value) ?? '';
    }

    public static function expandNumbers(string $value): string
    {
        return preg_replace_callback('/\d+/', function ($m) {
            return self::NUMBERS[$m[0]] ?? $m[0];
        }, $value) ?? $value;
    }

    public static function isHomophone(string $a, string $b): bool
    {
        $x = self::word(self::expandNumbers($a));
        $y = self::word(self::expandNumbers($b));

        if ($x === '' || $y === '') {
            return false;
        }

        if ($x === $y) {
            return true;
        }

        $map = self::groupMap();
        $gx = $map[$x] ?? [];
        $gy = $map[$y] ?? [];

        return (bool) array_intersect($gx, $gy);
    }

    private static function groupMap(): array
    {
        if (self::$groupOf !== null) {
            return self::$groupOf;
        }

        $map = [];
        foreach (self::GROUPS as $index => $group) {
            foreach ($group as $word) {
                $map[$word][] = $index;
            }
        }

        return self::$groupOf = $map;
    }
}
