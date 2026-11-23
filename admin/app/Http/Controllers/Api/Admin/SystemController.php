<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Admin\ConfigService;
use App\Services\Admin\LogService;
use Illuminate\Http\Request;

class SystemController extends Controller
{
    public function __construct(
        private readonly LogService $logService,
        private readonly ConfigService $configService,
    ) {}

    public function operationLogs(Request $request)
    {
        return $this->successPage($this->logService->operationLogs($request));
    }

    public function loginLogs(Request $request)
    {
        return $this->successPage($this->logService->loginLogs($request));
    }

    public function configs()
    {
        return $this->success($this->configService->all());
    }

    public function updateConfigs(Request $request)
    {
        $data = $request->validate([
            'items' => ['required', 'array'],
            'items.*.key' => ['required', 'string', 'max:128'],
            'items.*.value' => ['nullable'],
            'items.*.group' => ['nullable', 'string', 'max:64'],
            'items.*.remark' => ['nullable', 'string', 'max:255'],
        ]);

        $this->configService->updateMany($data['items']);

        return $this->success($this->configService->all(), '保存成功');
    }
}
