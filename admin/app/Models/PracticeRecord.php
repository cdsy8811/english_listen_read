<?php

namespace App\Models;

class PracticeRecord extends BaseModel
{
    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }

    public function word()
    {
        return $this->belongsTo(Word::class, 'word_uuid', 'uuid');
    }

    public function getDetailAttribute(): mixed
    {
        if (! $this->detail_json) {
            return null;
        }

        $decoded = json_decode((string) $this->detail_json, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $this->detail_json;
    }

    protected function casts(): array
    {
        return [
            'score' => 'integer',
            'created_at_ms' => 'integer',
            'client_updated_at_ms' => 'integer',
            'sync_seq' => 'integer',
        ];
    }
}
