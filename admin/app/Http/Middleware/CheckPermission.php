<?php

namespace App\Http\Middleware;

use App\Support\PermLib;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckPermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        if (! PermLib::checkPermission($request->user(), $permission)) {
            return response()->json([
                'code' => 2003,
                'msg' => '权限不足',
                'data' => [],
                'timestamp' => time(),
            ], 403);
        }

        return $next($request);
    }
}
