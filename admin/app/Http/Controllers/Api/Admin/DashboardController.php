<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Admin\DashboardService;

class DashboardController extends Controller
{
    public function __construct(private readonly DashboardService $service) {}

    public function overview()
    {
        return $this->success($this->service->overview());
    }
}
