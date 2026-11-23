<?php

namespace App\Http\Middleware;

use App\Models\AppUser;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAppUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user instanceof AppUser) {
            return response()->json([
                'code' => 2000,
                'msg' => 'Unauthenticated.',
                'data' => [],
                'timestamp' => time(),
            ], 401);
        }

        if ((int) $user->status !== 1) {
            return response()->json([
                'code' => 2004,
                'msg' => '账号已禁用',
                'data' => [],
                'timestamp' => time(),
            ], 403);
        }

        return $next($request);
    }
}
