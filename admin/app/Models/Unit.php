<?php

namespace App\Models;

class Unit extends BaseModel
{
    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }

    public function words()
    {
        return $this->hasMany(Word::class, 'unit_uuid', 'uuid');
    }

    protected function casts(): array
    {
        return [
            'created_at_ms' => 'integer',
            'client_updated_at_ms' => 'integer',
            'sync_seq' => 'integer',
        ];
    }
}
