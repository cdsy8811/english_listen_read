<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppDevice extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
        ];
    }

    public function appUser()
    {
        return $this->belongsTo(AppUser::class);
    }
}
