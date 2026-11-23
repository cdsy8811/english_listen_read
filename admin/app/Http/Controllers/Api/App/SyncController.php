<?php

namespace App\Http\Controllers\Api\App;

use App\Http\Controllers\Controller;
use App\Services\SyncService;
use Illuminate\Http\Request;

class SyncController extends Controller
{
    public function __construct(private readonly SyncService $service) {}

    public function pull(Request $request)
    {
        $data = $request->validate([
            'cursor' => ['nullable', 'integer', 'min:0'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        return $this->success($this->service->pull(
            $request->user(),
            (int) ($data['cursor'] ?? 0),
            (int) ($data['limit'] ?? 500)
        ));
    }

    public function push(Request $request)
    {
        $data = $request->validate([
            'changes' => ['required', 'array'],
            'changes.*.entity' => ['required', 'string'],
            'changes.*.op' => ['nullable', 'string', 'in:upsert,delete'],
            'changes.*.id' => ['nullable', 'string', 'max:64'],
            'changes.*.data' => ['nullable', 'array'],
            'changes.*.client_updated_at_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        return $this->success($this->service->push($request->user(), $data['changes']));
    }

    public function status(Request $request)
    {
        $user = $request->user();

        return $this->success([
            'cursor' => (int) $user->next_sync_seq - 1,
            'protocol_version' => (int) config('sync.protocol_version', 1),
            'counts' => [
                'units' => $user->units()->count(),
                'words' => $user->words()->count(),
                'practice_records' => $user->practiceRecords()->count(),
                'read_articles' => $user->readArticles()->count(),
                'read_records' => $user->readRecords()->count(),
                'study_sessions' => $user->studySessions()->count(),
            ],
        ]);
    }
}
