<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\ReadArticle;
use App\Services\Admin\RecordService;
use Illuminate\Http\Request;

class RecordController extends Controller
{
    public function __construct(private readonly RecordService $service) {}

    public function practiceRecords(Request $request)
    {
        return $this->successPage($this->service->practiceRecords($request));
    }

    public function articles(Request $request)
    {
        return $this->successPage($this->service->articles($request));
    }

    public function articleShow(ReadArticle $article)
    {
        return $this->success($this->service->articleDetail($article));
    }

    public function articleDestroy(ReadArticle $article)
    {
        $this->service->deleteArticle($article);

        return $this->success(null, '已删除');
    }

    public function readRecords(Request $request)
    {
        return $this->successPage($this->service->readRecords($request));
    }

    public function sessions(Request $request)
    {
        return $this->successPage($this->service->sessions($request));
    }

    public function sessionSummary(Request $request)
    {
        return $this->success($this->service->sessionSummary($request));
    }
}
