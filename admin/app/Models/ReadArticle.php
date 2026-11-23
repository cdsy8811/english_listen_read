<?php

namespace App\Models;

class ReadArticle extends BaseModel
{
    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }

    public function records()
    {
        return $this->hasMany(ReadRecord::class, 'article_uuid', 'uuid');
    }

    public function getSentencesAttribute(): array
    {
        $decoded = json_decode((string) $this->content, true);

        return is_array($decoded) ? $decoded : [];
    }

    public function getTranslationsArrayAttribute(): array
    {
        $decoded = json_decode((string) $this->translations, true);

        return is_array($decoded) ? $decoded : [];
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
