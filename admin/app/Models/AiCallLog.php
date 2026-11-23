<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiCallLog extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }

    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }
}
