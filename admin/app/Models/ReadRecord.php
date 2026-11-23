<?php

namespace App\Models;

class ReadRecord extends BaseModel
{
    public function article()
    {
        return $this->belongsTo(ReadArticle::class, 'article_uuid', 'uuid');
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
            'sentence_index' => 'integer',
            'score' => 'integer',
            'created_at_ms' => 'integer',
            'client_updated_at_ms' => 'integer',
            'sync_seq' => 'integer',
        ];
    }
}
