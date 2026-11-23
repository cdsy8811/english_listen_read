<?php

namespace App\Models;

class AppSetting extends BaseModel
{
    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }

    public function getPayloadArrayAttribute(): array
    {
        $decoded = json_decode((string) $this->payload, true);

        return is_array($decoded) ? $decoded : [];
    }

    protected function casts(): array
    {
        return [
            'client_updated_at_ms' => 'integer',
            'sync_seq' => 'integer',
        ];
    }
}
