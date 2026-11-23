<?php

namespace App\Models;

use Carbon\Carbon;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

abstract class BaseModel extends Model
{
    use HasFactory, SoftDeletes;

    protected $guarded = [];

    protected function serializeDate(DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }

    public function formatDateValue(mixed $value, string $format = 'Y-m-d H:i:s'): ?string
    {
        if (empty($value)) {
            return null;
        }

        if ($value instanceof DateTimeInterface) {
            return $value->format($format);
        }

        return Carbon::parse((string) $value)->format($format);
    }

    public function scopeForUser($query, int $appUserId)
    {
        return $query->where($query->getModel()->qualifyColumn('app_user_id'), $appUserId);
    }
}
