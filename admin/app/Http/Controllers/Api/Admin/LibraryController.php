<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Unit;
use App\Models\Word;
use App\Services\Admin\LibraryService;
use Illuminate\Http\Request;

class LibraryController extends Controller
{
    public function __construct(private readonly LibraryService $service) {}

    public function units(Request $request)
    {
        return $this->successPage($this->service->units($request));
    }

    public function storeUnit(Request $request)
    {
        $data = $request->validate([
            'app_user_id' => ['required', 'integer', 'exists:app_users,id'],
            'title' => ['required', 'string', 'max:255'],
            'source_img' => ['nullable', 'string', 'max:500'],
        ]);

        $unit = $this->service->createUnit($data);

        return $this->success($this->service->unitRow($unit->loadCount('words')->load('appUser:id,username,nickname')), '创建成功');
    }

    public function updateUnit(Request $request, Unit $unit)
    {
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'source_img' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $unit = $this->service->updateUnit($unit, $data);

        return $this->success($this->service->unitRow($unit->loadCount('words')->load('appUser:id,username,nickname')), '保存成功');
    }

    public function destroyUnit(Unit $unit)
    {
        $count = $this->service->deleteUnit($unit);

        return $this->success(['deleted' => $count], '已删除单元及其词条');
    }

    public function words(Request $request)
    {
        return $this->successPage($this->service->words($request));
    }

    public function storeWord(Request $request, Unit $unit)
    {
        $data = $request->validate([
            'word' => ['required', 'string', 'max:128'],
            'phonetic_uk' => ['nullable', 'string', 'max:128'],
            'phonetic_us' => ['nullable', 'string', 'max:128'],
            'pos' => ['nullable', 'string', 'max:64'],
            'translation' => ['nullable', 'string'],
            'example' => ['nullable', 'string'],
            'audio_path' => ['nullable', 'string', 'max:500'],
            'sort' => ['nullable', 'integer'],
            'wrong' => ['nullable', 'integer', 'in:0,1'],
            'wrong_count' => ['nullable', 'integer', 'min:0'],
        ]);

        $word = $this->service->createWord($unit, $data);

        return $this->success($this->service->wordRow($word->load('unit:id,uuid,title')), '创建成功');
    }

    public function updateWord(Request $request, Word $word)
    {
        $data = $request->validate([
            'word' => ['sometimes', 'string', 'max:128'],
            'phonetic_uk' => ['sometimes', 'nullable', 'string', 'max:128'],
            'phonetic_us' => ['sometimes', 'nullable', 'string', 'max:128'],
            'pos' => ['sometimes', 'nullable', 'string', 'max:64'],
            'translation' => ['sometimes', 'nullable', 'string'],
            'example' => ['sometimes', 'nullable', 'string'],
            'audio_path' => ['sometimes', 'nullable', 'string', 'max:500'],
            'sort' => ['sometimes', 'integer'],
            'wrong' => ['sometimes', 'integer', 'in:0,1'],
            'wrong_count' => ['sometimes', 'integer', 'min:0'],
        ]);

        $word = $this->service->updateWord($word, $data);

        return $this->success($this->service->wordRow($word->load('unit:id,uuid,title')), '保存成功');
    }

    public function destroyWord(Word $word)
    {
        $this->service->deleteWord($word);

        return $this->success(null, '已删除');
    }

    public function exportWords(Request $request)
    {
        return $this->service->exportWords($request);
    }
}
