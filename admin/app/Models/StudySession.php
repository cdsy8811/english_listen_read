<?php

namespace App\Models;

class StudySession extends BaseModel
{
    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }

    protected function casts(): array
    {
        return [
            'started_at_ms' => 'integer',
            'ended_at_ms' => 'integer',
            'duration_sec' => 'integer',
            'total' => 'integer',
            'answered' => 'integer',
            'passed' => 'integer',
            'avg_score' => 'integer',
            'created_at_ms' => 'integer',
            'client_updated_at_ms' => 'integer',
            'sync_seq' => 'integer',
        ];
    }
}
