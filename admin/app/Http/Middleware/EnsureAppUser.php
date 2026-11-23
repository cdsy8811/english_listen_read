<?php

namespace App\Http\Middleware;

use App\Models\AppDevice;
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

        $token = $user->currentAccessToken();
        if ($token && str_starts_with((string) $token->name, 'app:')) {
            AppDevice::where('app_user_id', $user->id)
                ->where('device_id', substr((string) $token->name, 4))
                ->where(function ($query) {
                    $query->whereNull('last_seen_at')->orWhere('last_seen_at', '<', now()->subMinutes(5));
                })
                ->update([
                    'last_seen_at' => now(),
                    'last_ip' => (string) $request->ip(),
                    'updated_at' => now(),
                ]);
        }

        return $next($request);
    }
}
