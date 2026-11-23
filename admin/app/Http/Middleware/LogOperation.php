<?php

namespace App\Http\Middleware;

use App\Models\OperationLog;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class LogOperation
{
    /** 只记录写操作，避免列表查询把日志表撑爆。 */
    private const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    public function handle(Request $request, Closure $next): Response
    {
        $started = microtime(true);
        $response = $next($request);

        if (! in_array($request->method(), self::WRITE_METHODS, true)) {
            return $response;
        }

        // 健康检查、登录失败等不记录敏感路径
        if ($request->is('up') || $request->is('api/*/auth/login') || $request->is('api/v1/*')) {
            return $response;
        }

        try {
            OperationLog::create([
                'user_id' => $request->user()?->id,
                'method' => $request->method(),
                'path' => '/'.ltrim($request->path(), '/'),
                'status' => $response->getStatusCode(),
                'duration_ms' => (int) round((microtime(true) - $started) * 1000),
                'ip' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
                'created_at' => now(),
            ]);
        } catch (Throwable) {
            // 日志失败不影响业务
        }

        return $response;
    }
}
