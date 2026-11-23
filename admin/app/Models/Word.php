<?php

namespace App\Models;

class Word extends BaseModel
{
    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }

    public function unit()
    {
        return $this->belongsTo(Unit::class, 'unit_uuid', 'uuid');
    }

    protected function casts(): array
    {
        return [
            'sort' => 'integer',
            'wrong' => 'integer',
            'wrong_count' => 'integer',
            'client_updated_at_ms' => 'integer',
            'sync_seq' => 'integer',
        ];
    }
}
