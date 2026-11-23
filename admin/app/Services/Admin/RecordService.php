<?php

namespace App\Services\Admin;

use App\Models\AppUser;
use App\Models\PracticeRecord;
use App\Models\ReadArticle;
use App\Models\ReadRecord;
use App\Models\StudySession;
use App\Services\BaseService;
use App\Support\SyncSequence;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RecordService extends BaseService
{
    public function practiceRecords(Request $request)
    {
        $query = PracticeRecord::query()->with('word:id,uuid,word,translation');

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(function ($builder) use ($keyword) {
                $builder->where('raw_text', 'like', '%'.$keyword.'%')
                    ->orWhere('asr_text', 'like', '%'.$keyword.'%');
            });
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (PracticeRecord $record) => [
            'id' => $record->id,
            'uuid' => $record->uuid,
            'app_user_id' => $record->app_user_id,
            'word' => $record->word?->word,
            'translation' => $record->word?->translation,
            'mode' => $record->mode,
            'input_type' => $record->input_type,
            'raw_text' => $record->raw_text,
            'asr_text' => $record->asr_text,
            'score' => (int) $record->score,
            'detail' => $record->detail,
            'created_at_ms' => (int) $record->created_at_ms,
            'created_at' => $record->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function articles(Request $request)
    {
        $query = ReadArticle::query();

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where('title', 'like', '%'.$keyword.'%');
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (ReadArticle $article) => [
            'id' => $article->id,
            'uuid' => $article->uuid,
            'app_user_id' => $article->app_user_id,
            'title' => $article->title,
            'source_img' => $article->source_img,
            'sentences_count' => count($article->sentences),
            'sentences' => $article->sentences,
            'translations' => $article->translations_array,
            'created_at_ms' => (int) $article->created_at_ms,
            'created_at' => $article->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function articleDetail(ReadArticle $article): array
    {
        return [
            'id' => $article->id,
            'uuid' => $article->uuid,
            'app_user_id' => $article->app_user_id,
            'title' => $article->title,
            'sentences' => $article->sentences,
            'translations' => $article->translations_array,
            'records' => $article->records()->orderByDesc('created_at_ms')->limit(50)->get()->map(fn (ReadRecord $r) => [
                'id' => $r->id,
                'sentence_index' => (int) $r->sentence_index,
                'asr_text' => $r->asr_text,
                'score' => (int) $r->score,
                'detail' => $r->detail,
                'created_at' => $r->created_at?->format('Y-m-d H:i:s'),
            ])->all(),
        ];
    }

    public function deleteArticle(ReadArticle $article): void
    {
        DB::transaction(function () use ($article) {
            $user = $article->appUser ?? AppUser::findOrFail($article->app_user_id);
            $seq = SyncSequence::allocate($user, 2);
            $now = (int) floor(microtime(true) * 1000);

            $article->forceFill([
                'client_updated_at_ms' => $now,
                'sync_seq' => $seq,
                'deleted_at' => now(),
            ])->save();

            foreach ($article->records()->whereNull('deleted_at')->get() as $record) {
                $record->forceFill([
                    'client_updated_at_ms' => $now,
                    'sync_seq' => $seq + 1,
                    'deleted_at' => now(),
                ])->save();
            }
        });
    }

    public function readRecords(Request $request)
    {
        $query = ReadRecord::query()->with('article:id,uuid,title');

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (ReadRecord $record) => [
            'id' => $record->id,
            'uuid' => $record->uuid,
            'app_user_id' => $record->app_user_id,
            'article_title' => $record->article?->title,
            'sentence_index' => (int) $record->sentence_index,
            'asr_text' => $record->asr_text,
            'score' => (int) $record->score,
            'detail' => $record->detail,
            'created_at' => $record->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function sessions(Request $request)
    {
        $query = StudySession::query();

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where('title', 'like', '%'.$keyword.'%');
        }

        $this->handleSearch($query, $request->all());

        return $this->paginateQuery($query, $request, fn (StudySession $session) => [
            'id' => $session->id,
            'uuid' => $session->uuid,
            'app_user_id' => $session->app_user_id,
            'kind' => $session->kind,
            'mode' => $session->mode,
            'title' => $session->title,
            'duration_sec' => (int) $session->duration_sec,
            'total' => (int) $session->total,
            'answered' => (int) $session->answered,
            'passed' => (int) $session->passed,
            'avg_score' => (int) $session->avg_score,
            'started_at_ms' => (int) $session->started_at_ms,
            'created_at' => $session->created_at?->format('Y-m-d H:i:s'),
        ]);
    }

    public function sessionSummary(Request $request): array
    {
        $query = StudySession::query();
        $this->handleSearch($query, array_merge($request->all(), ['keyword' => null]));

        $total = (clone $query)->count();
        $duration = (int) (clone $query)->sum('duration_sec');
        $avgScore = (float) (clone $query)->avg('avg_score');

        $days = max(7, min(90, (int) $request->input('days', 14)));
        $since = now()->subDays($days)->startOfDay();

        $trend = StudySession::query()
            ->selectRaw('DATE(created_at) as day, COUNT(*) as sessions, SUM(duration_sec) as duration, AVG(avg_score) as avg_score')
            ->where('created_at', '>=', $since)
            ->groupBy('day')
            ->orderBy('day')
            ->get()
            ->map(fn ($row) => [
                'day' => $row->day,
                'sessions' => (int) $row->sessions,
                'duration' => (int) $row->duration,
                'avg_score' => round((float) $row->avg_score, 1),
            ])->all();

        return [
            'total' => $total,
            'duration' => $duration,
            'avg_score' => round($avgScore, 1),
            'trend' => $trend,
        ];
    }
}
