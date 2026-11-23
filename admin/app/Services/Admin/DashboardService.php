<?php

namespace App\Services\Admin;

use App\Models\AiCallLog;
use App\Models\AppDevice;
use App\Models\AppUser;
use App\Models\PracticeRecord;
use App\Models\StudySession;
use App\Models\Unit;
use App\Models\Word;
use App\Services\BaseService;

class DashboardService extends BaseService
{
    public function overview(): array
    {
        $today = now()->startOfDay();

        $counts = [
            'app_users' => AppUser::count(),
            'devices' => AppDevice::count(),
            'units' => Unit::count(),
            'words' => Word::count(),
            'practice_records' => PracticeRecord::count(),
            'study_sessions' => StudySession::count(),
            'ai_calls_today' => AiCallLog::where('created_at', '>=', $today)->count(),
        ];

        return [
            'counts' => $counts,
            'trends' => $this->trends(14),
            'recent_users' => AppUser::query()->orderByDesc('id')->limit(8)->get()
                ->map(fn (AppUser $user) => [
                    'id' => $user->id,
                    'username' => $user->username,
                    'nickname' => $user->nickname,
                    'status' => (int) $user->status,
                    'created_at' => $user->created_at?->format('Y-m-d H:i:s'),
                ])->all(),
            'ai_by_capability' => AiCallLog::query()
                ->selectRaw('capability, COUNT(*) as total')
                ->where('created_at', '>=', now()->subDays(14)->startOfDay())
                ->groupBy('capability')
                ->orderByDesc('total')
                ->get()
                ->map(fn ($row) => ['capability' => $row->capability, 'total' => (int) $row->total])
                ->all(),
        ];
    }

    private function trends(int $days): array
    {
        $since = now()->subDays($days - 1)->startOfDay();

        $sessions = StudySession::query()
            ->selectRaw('DATE(created_at) as day, COUNT(*) as sessions, SUM(duration_sec) as duration, AVG(avg_score) as avg_score')
            ->where('created_at', '>=', $since)
            ->groupBy('day')->orderBy('day')->get()->keyBy('day');

        $records = PracticeRecord::query()
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total, AVG(score) as avg_score')
            ->where('created_at', '>=', $since)
            ->groupBy('day')->orderBy('day')->get()->keyBy('day');

        $ai = AiCallLog::query()
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total')
            ->where('created_at', '>=', $since)
            ->groupBy('day')->orderBy('day')->get()->keyBy('day');

        $out = [];
        for ($i = 0; $i < $days; $i++) {
            $day = $since->copy()->addDays($i)->toDateString();
            $out[] = [
                'day' => $day,
                'sessions' => (int) ($sessions[$day]->sessions ?? 0),
                'duration' => (int) ($sessions[$day]->duration ?? 0),
                'session_avg_score' => round((float) ($sessions[$day]->avg_score ?? 0), 1),
                'records' => (int) ($records[$day]->total ?? 0),
                'record_avg_score' => round((float) ($records[$day]->avg_score ?? 0), 1),
                'ai_calls' => (int) ($ai[$day]->total ?? 0),
            ];
        }

        return $out;
    }
}
