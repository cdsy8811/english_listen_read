<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SystemConfig extends Model
{
    protected $guarded = [];

    public static function getValue(string $key, mixed $default = null): mixed
    {
        $value = static::where('key', $key)->value('value');

        return $value === null ? $default : $value;
    }

    public static function setValue(string $key, mixed $value, string $group = 'basic', string $remark = ''): void
    {
        static::updateOrCreate(
            ['key' => $key],
            ['value' => is_scalar($value) || $value === null ? $value : json_encode($value), 'group' => $group, 'remark' => $remark]
        );
    }
}
