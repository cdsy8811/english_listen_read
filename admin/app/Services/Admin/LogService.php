<?php

namespace App\Services\Admin;

use App\Models\LoginLog;
use App\Models\OperationLog;
use App\Services\BaseService;
use Illuminate\Http\Request;

class LogService extends BaseService
{
    public function operationLogs(Request $request)
    {
        $query = OperationLog::query();
        $this->handleSearch($query, $request->all());

        if ($keyword = trim((string) $request->input('keyword', ''))) {
            $query->where('path', 'like', '%'.$keyword.'%');
        }

        return $this->paginateQuery($query, $request, fn (OperationLog $log) => [
            'id' => $log->id,
            'user_id' => $log->user_id,
            'method' => $log->method,
            'path' => $log->path,
            'status' => (int) $log->status,
            'duration_ms' => (int) $log->duration_ms,
            'ip' => $log->ip,
            'created_at' => $log->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function loginLogs(Request $request)
    {
        $query = LoginLog::query();
        $this->handleSearch($query, $request->all());

        if ($keyword = trim((string) $request->input('keyword', ''))) {
            $query->where('username', 'like', '%'.$keyword.'%');
        }

        return $this->paginateQuery($query, $request, fn (LoginLog $log) => [
            'id' => $log->id,
            'user_type' => $log->user_type,
            'user_id' => $log->user_id,
            'username' => $log->username,
            'success' => (int) $log->success,
            'message' => $log->message,
            'ip' => $log->ip,
            'created_at' => $log->created_at?->format('Y-m-d H:i:s'),
        ]);
    }
}
