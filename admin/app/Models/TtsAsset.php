<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TtsAsset extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'bytes' => 'integer',
            'hits' => 'integer',
            'last_used_at' => 'datetime',
        ];
    }
}
