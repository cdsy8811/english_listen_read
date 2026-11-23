<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class AppUser extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    protected $guarded = [];

    protected $hidden = ['password'];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'status' => 'integer',
            'last_login_at' => 'datetime',
            'next_sync_seq' => 'integer',
        ];
    }

    public function devices()
    {
        return $this->hasMany(AppDevice::class);
    }

    public function units()
    {
        return $this->hasMany(Unit::class);
    }

    public function words()
    {
        return $this->hasMany(Word::class);
    }

    public function practiceRecords()
    {
        return $this->hasMany(PracticeRecord::class);
    }

    public function readArticles()
    {
        return $this->hasMany(ReadArticle::class);
    }

    public function readRecords()
    {
        return $this->hasMany(ReadRecord::class);
    }

    public function studySessions()
    {
        return $this->hasMany(StudySession::class);
    }

    public function setting()
    {
        return $this->hasOne(AppSetting::class);
    }

    public function toProfileArray(): array
    {
        return [
            'id' => $this->id,
            'uuid' => $this->uuid,
            'username' => $this->username,
            'nickname' => $this->nickname,
            'status' => (int) $this->status,
            'last_login_at' => $this->last_login_at?->format('Y-m-d H:i:s'),
            'created_at' => $this->created_at?->format('Y-m-d H:i:s'),
        ];
    }
}
