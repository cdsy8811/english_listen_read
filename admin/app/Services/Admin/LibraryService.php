<?php

namespace App\Services\Admin;

use App\Models\AppUser;
use App\Models\Unit;
use App\Models\Word;
use App\Services\BaseService;
use App\Support\SyncSequence;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LibraryService extends BaseService
{
    public function units(Request $request)
    {
        $query = Unit::query()->with('appUser:id,username,nickname')->withCount('words');

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where('title', 'like', '%'.$keyword.'%');
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (Unit $unit) => $this->unitRow($unit));
    }

    public function unitRow(Unit $unit): array
    {
        return [
            'id' => $unit->id,
            'uuid' => $unit->uuid,
            'app_user_id' => $unit->app_user_id,
            'app_user' => $unit->relationLoaded('appUser') && $unit->appUser
                ? ['username' => $unit->appUser->username, 'nickname' => $unit->appUser->nickname]
                : null,
            'title' => $unit->title,
            'source_img' => $unit->source_img,
            'words_count' => (int) ($unit->words_count ?? 0),
            'created_at_ms' => (int) $unit->created_at_ms,
            'created_at' => $unit->created_at?->format('Y-m-d H:i:s'),
            'updated_at' => $unit->updated_at?->format('Y-m-d H:i:s'),
        ];
    }

    public function createUnit(array $data): Unit
    {
        $user = AppUser::findOrFail($data['app_user_id']);
        $seq = SyncSequence::allocate($user);

        return Unit::create([
            'app_user_id' => $user->id,
            'uuid' => 'u_admin_'.Str::lower((string) Str::ulid()),
            'title' => trim((string) $data['title']),
            'source_img' => (string) ($data['source_img'] ?? ''),
            'created_at_ms' => (int) ($data['created_at_ms'] ?? floor(microtime(true) * 1000)),
            'client_updated_at_ms' => (int) floor(microtime(true) * 1000),
            'sync_seq' => $seq,
        ]);
    }

    public function updateUnit(Unit $unit, array $data): Unit
    {
        $user = AppUser::findOrFail($unit->app_user_id);
        $seq = SyncSequence::allocate($user);

        $unit->fill([
            'title' => array_key_exists('title', $data) ? trim((string) $data['title']) : $unit->title,
            'source_img' => array_key_exists('source_img', $data) ? (string) $data['source_img'] : $unit->source_img,
            'client_updated_at_ms' => (int) floor(microtime(true) * 1000),
            'sync_seq' => $seq,
        ])->save();

        return $unit->refresh();
    }

    public function deleteUnit(Unit $unit): int
    {
        return DB::transaction(function () use ($unit) {
            $user = AppUser::findOrFail($unit->app_user_id);
            $words = Word::where('app_user_id', $unit->app_user_id)
                ->where('unit_uuid', $unit->uuid)
                ->whereNull('deleted_at')
                ->get();

            $seq = SyncSequence::allocate($user, $words->count() + 1);
            $now = (int) floor(microtime(true) * 1000);

            foreach ($words as $index => $word) {
                $word->forceFill([
                    'client_updated_at_ms' => $now,
                    'sync_seq' => $seq + $index,
                    'deleted_at' => now(),
                ])->save();
            }

            $unit->forceFill([
                'client_updated_at_ms' => $now,
                'sync_seq' => $seq + $words->count(),
                'deleted_at' => now(),
            ])->save();

            return $words->count() + 1;
        });
    }

    public function words(Request $request)
    {
        $query = Word::query()->with('unit:id,uuid,title');

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(function ($builder) use ($keyword) {
                $builder->where('word', 'like', '%'.$keyword.'%')
                    ->orWhere('translation', 'like', '%'.$keyword.'%');
            });
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (Word $word) => $this->wordRow($word));
    }

    public function wordRow(Word $word): array
    {
        return [
            'id' => $word->id,
            'uuid' => $word->uuid,
            'app_user_id' => $word->app_user_id,
            'unit_uuid' => $word->unit_uuid,
            'unit_title' => $word->relationLoaded('unit') && $word->unit ? $word->unit->title : '',
            'word' => $word->word,
            'phonetic_uk' => $word->phonetic_uk,
            'phonetic_us' => $word->phonetic_us,
            'pos' => $word->pos,
            'translation' => $word->translation,
            'example' => $word->example,
            'audio_path' => $word->audio_path,
            'sort' => (int) $word->sort,
            'wrong' => (int) $word->wrong,
            'wrong_count' => (int) $word->wrong_count,
            'updated_at' => $word->updated_at?->format('Y-m-d H:i:s'),
        ];
    }

    public function createWord(Unit $unit, array $data): Word
    {
        $user = AppUser::findOrFail($unit->app_user_id);
        $seq = SyncSequence::allocate($user);
        $now = (int) floor(microtime(true) * 1000);

        return Word::create([
            'app_user_id' => $unit->app_user_id,
            'uuid' => 'w_admin_'.Str::lower((string) Str::ulid()),
            'unit_uuid' => $unit->uuid,
            'word' => trim((string) $data['word']),
            'phonetic_uk' => (string) ($data['phonetic_uk'] ?? ''),
            'phonetic_us' => (string) ($data['phonetic_us'] ?? ''),
            'pos' => (string) ($data['pos'] ?? ''),
            'translation' => (string) ($data['translation'] ?? ''),
            'example' => (string) ($data['example'] ?? ''),
            'audio_path' => (string) ($data['audio_path'] ?? ''),
            'sort' => (int) ($data['sort'] ?? 0),
            'wrong' => (int) ($data['wrong'] ?? 0),
            'wrong_count' => (int) ($data['wrong_count'] ?? 0),
            'client_updated_at_ms' => $now,
            'sync_seq' => $seq,
        ]);
    }

    public function updateWord(Word $word, array $data): Word
    {
        $user = AppUser::findOrFail($word->app_user_id);
        $seq = SyncSequence::allocate($user);

        $fillable = [
            'word', 'phonetic_uk', 'phonetic_us', 'pos', 'translation',
            'example', 'audio_path', 'sort', 'wrong', 'wrong_count',
        ];

        foreach ($fillable as $field) {
            if (array_key_exists($field, $data)) {
                $word->{$field} = $data[$field];
            }
        }

        $word->forceFill([
            'client_updated_at_ms' => (int) floor(microtime(true) * 1000),
            'sync_seq' => $seq,
        ])->save();

        return $word->refresh();
    }

    public function deleteWord(Word $word): void
    {
        $user = AppUser::findOrFail($word->app_user_id);
        $seq = SyncSequence::allocate($user);

        $word->forceFill([
            'client_updated_at_ms' => (int) floor(microtime(true) * 1000),
            'sync_seq' => $seq,
            'deleted_at' => now(),
        ])->save();
    }

    public function exportWords(Request $request)
    {
        $query = Word::query()->with('unit:id,uuid,title');

        $this->handleSearch($query, array_merge($request->all(), ['keyword' => null]));
        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(fn ($q) => $q->where('word', 'like', '%'.$keyword.'%')
                ->orWhere('translation', 'like', '%'.$keyword.'%'));
        }

        $rows = $query->orderBy('id')->cursor();

        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['单元', '单词', '音标UK', '音标US', '词性', '释义', '例句', '错词', '错误次数', '更新时间']);

            foreach ($rows as $word) {
                fputcsv($out, [
                    $word->unit?->title ?? '',
                    $word->word,
                    $word->phonetic_uk,
                    $word->phonetic_us,
                    $word->pos,
                    $word->translation,
                    $word->example,
                    (int) $word->wrong === 1 ? '是' : '否',
                    (int) $word->wrong_count,
                    $word->updated_at?->format('Y-m-d H:i:s'),
                ]);
            }

            fclose($out);
        }, 'words-'.date('Ymd-His').'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }
}
