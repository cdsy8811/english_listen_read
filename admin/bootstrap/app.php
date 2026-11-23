<?php

use App\Console\Commands\CreateAdmin;
use App\Console\Commands\PruneLogs;
use App\Console\Commands\PruneTombstones;
use App\Console\Commands\PruneTtsCache;
use App\Http\Middleware\CheckPermission;
use App\Http\Middleware\EnsureAppUser;
use App\Http\Middleware\LogOperation;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withCommands([
        CreateAdmin::class,
        PruneTtsCache::class,
        PruneTombstones::class,
        PruneLogs::class,
    ])
    ->withSchedule(function (Schedule $schedule): void {
        $schedule->command('app:prune-tts')->dailyAt('03:10')->withoutOverlapping(30);
        $schedule->command('app:prune-tombstones')->dailyAt('03:20')->withoutOverlapping(30);
        $schedule->command('app:prune-logs')->weeklyOn(1, '03:30')->withoutOverlapping(30);
    })
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'permission' => CheckPermission::class,
            'log.operation' => LogOperation::class,
            'app.user' => EnsureAppUser::class,
        ]);

        $middleware->appendToGroup('api', LogOperation::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request, Throwable $e) => $request->is('api/*') || $request->expectsJson()
        );

        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/*') && ! $request->expectsJson()) {
                return null;
            }

            $code = 1000;
            $msg = $e->getMessage() ?: 'Server Error';
            $data = [];
            $status = 500;

            if ($e instanceof ValidationException) {
                $code = 3000;
                $msg = $e->validator->errors()->first();
                $data = $e->validator->errors()->toArray();
                $status = 422;
            } elseif ($e instanceof AuthenticationException) {
                $code = 2000;
                $msg = 'Unauthenticated.';
                $status = 401;
            } elseif ($e instanceof NotFoundHttpException) {
                $code = 3004;
                $msg = 'Resource not found.';
                $status = 404;
            } elseif ($e instanceof AccessDeniedHttpException) {
                $code = 2003;
                $msg = 'Access denied.';
                $status = 403;
            } elseif ($e instanceof HttpExceptionInterface) {
                $status = $e->getStatusCode();
                $code = $status >= 400 && $status < 500 ? 3000 + $status : 1000;
            }

            if (config('app.debug') && $status === 500) {
                $data = ['exception' => get_class($e)];
            }

            return response()->json([
                'code' => $code,
                'msg' => $msg,
                'data' => $data,
                'timestamp' => time(),
            ], $status);
        });
    })->create();
