<?php

namespace App\Services;

use App\Models\AppSetting;
use App\Models\AppUser;
use App\Models\PracticeRecord;
use App\Models\ReadArticle;
use App\Models\ReadRecord;
use App\Models\StudySession;
use App\Models\Unit;
use App\Models\Word;
use App\Support\SyncSequence;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SyncService
{
    private const MAX_FUTURE_MS = 86400000;

    /** @return array<string, class-string<Model>> */
    private function models(): array
    {
        return [
            'unit' => Unit::class,
            'word' => Word::class,
            'practice_record' => PracticeRecord::class,
            'read_article' => ReadArticle::class,
            'read_record' => ReadRecord::class,
            'study_session' => StudySession::class,
            'setting' => AppSetting::class,
        ];
    }

    public function pull(AppUser $user, int $cursor, int $limit = 500): array
    {
        $limit = max(1, min((int) config('sync.max_pull', 500), $limit));
        $cursor = max(0, $cursor);
        $all = [];

        foreach ($this->models() as $entity => $class) {
            /** @var Builder $query */
            $query = $class::query()->withTrashed();

            if ($entity === 'setting') {
                $rows = $query->where('app_user_id', $user->id)
                    ->where('sync_seq', '>', $cursor)
                    ->orderBy('sync_seq')
                    ->limit($limit + 1)
                    ->get();
            } else {
                $rows = $query->where('app_user_id', $user->id)
                    ->where('sync_seq', '>', $cursor)
                    ->orderBy('sync_seq')
                    ->limit($limit + 1)
                    ->get();
            }

            foreach ($rows as $row) {
                $all[] = $this->changeFromRow($entity, $row);
            }
        }

        usort($all, fn ($a, $b) => $a['seq'] <=> $b['seq']);
        $hasMore = count($all) > $limit;
        $changes = array_slice($all, 0, $limit);
        $nextCursor = $changes ? (int) end($changes)['seq'] : $cursor;

        return [
            'changes' => $changes,
            'next_cursor' => $nextCursor,
            'has_more' => $hasMore,
            'server_time_ms' => $this->nowMs(),
        ];
    }

    public function push(AppUser $user, array $changes): array
    {
        $max = (int) config('sync.max_push', 500);
        if (count($changes) > $max) {
            throw ValidationException::withMessages(['changes' => ["单次最多推送 {$max} 条"]]);
        }

        $nowMs = $this->nowMs();
        $prepared = [];
        foreach ($changes as $item) {
            $prepared[] = $this->prepareChange($item, $nowMs);
        }

        if (! $prepared) {
            return ['results' => [], 'next_cursor' => (int) $user->next_sync_seq - 1];
        }

        return DB::transaction(function () use ($user, $prepared, $nowMs) {
            $start = SyncSequence::allocate($user, count($prepared));
            $results = [];
            $seq = $start;

            foreach ($prepared as $item) {
                $result = $this->applyChange($user, $item, $seq, $nowMs);
                $results[] = $result;
                $seq++;
            }

            return [
                'results' => $results,
                'next_cursor' => $start + count($prepared) - 1,
                'server_time_ms' => $nowMs,
            ];
        });
    }

    private function prepareChange(array $item, int $nowMs): array
    {
        $entity = (string) ($item['entity'] ?? '');
        if (! array_key_exists($entity, $this->models())) {
            return ['entity' => $entity, 'invalid' => true, 'message' => '未知实体'];
        }

        $op = (string) ($item['op'] ?? 'upsert');
        if (! in_array($op, ['upsert', 'delete'], true)) {
            return ['entity' => $entity, 'invalid' => true, 'message' => '未知操作'];
        }

        $id = trim((string) ($item['id'] ?? ''));
        if ($id === '' && $entity !== 'setting') {
            return ['entity' => $entity, 'invalid' => true, 'message' => '缺少 id'];
        }

        $data = $item['data'] ?? [];
        if (! is_array($data)) {
            $data = [];
        }

        $clientTs = (int) ($item['client_updated_at_ms'] ?? $data['updated_at_ms'] ?? $data['updatedAtMs'] ?? 0);
        if ($clientTs <= 0) {
            $clientTs = $nowMs;
        }

        if ($clientTs > $nowMs + self::MAX_FUTURE_MS) {
            return ['entity' => $entity, 'id' => $id, 'op' => $op, 'invalid' => true, 'message' => '客户端时间超前服务器 24 小时'];
        }

        if ($op === 'delete' && $entity === 'setting') {
            return ['entity' => $entity, 'id' => $id, 'op' => $op, 'invalid' => true, 'message' => '设置不支持删除'];
        }

        $reason = $op === 'upsert' ? $this->validatePayload($entity, $data) : null;
        if ($reason) {
            return ['entity' => $entity, 'id' => $id, 'op' => $op, 'invalid' => true, 'message' => $reason];
        }

        return [
            'entity' => $entity,
            'id' => $id !== '' ? $id : 'default',
            'op' => $op,
            'data' => $data,
            'client_updated_at_ms' => $clientTs,
        ];
    }

    private function applyChange(AppUser $user, array $item, int $seq, int $nowMs): array
    {
        $entity = $item['entity'];

        if (! empty($item['invalid'])) {
            return [
                'entity' => $entity,
                'id' => $item['id'] ?? '',
                'op' => $item['op'] ?? 'upsert',
                'status' => 'invalid',
                'message' => $item['message'] ?? '参数不合法',
            ];
        }

        /** @var class-string<Model> $class */
        $class = $this->models()[$entity];
        /** @var Model|null $model */
        $model = $class::query()->withTrashed();

        if ($entity === 'setting') {
            $model = $model->where('app_user_id', $user->id)->first();
        } else {
            $model = $model->where('app_user_id', $user->id)->where('uuid', $item['id'])->first();
        }

        $incoming = (int) $item['client_updated_at_ms'];

        if ($item['op'] === 'delete') {
            if (! $model) {
                return [
                    'entity' => $entity,
                    'id' => $item['id'],
                    'op' => 'delete',
                    'status' => 'applied',
                    'seq' => null,
                ];
            }

            if ($incoming <= (int) $model->client_updated_at_ms) {
                return $this->staleResult($entity, $item['id'], 'delete', $model);
            }

            $model->forceFill([
                'client_updated_at_ms' => $incoming,
                'sync_seq' => $seq,
                'deleted_at' => now(),
            ])->save();

            return [
                'entity' => $entity,
                'id' => $item['id'],
                'op' => 'delete',
                'status' => 'applied',
                'seq' => $seq,
            ];
        }

        if ($model && $incoming <= (int) $model->client_updated_at_ms) {
            return $this->staleResult($entity, $item['id'], 'upsert', $model);
        }

        if (! $model) {
            $model = new $class;
            $model->app_user_id = $user->id;
            if ($entity !== 'setting') {
                $model->uuid = $item['id'];
            }
        }

        $this->fillModel($entity, $model, $item['data'], $incoming, $seq);

        return [
            'entity' => $entity,
            'id' => $item['id'],
            'op' => 'upsert',
            'status' => 'applied',
            'seq' => $seq,
        ];
    }

    private function staleResult(string $entity, string $id, string $op, Model $model): array
    {
        return [
            'entity' => $entity,
            'id' => $id,
            'op' => $op,
            'status' => 'stale',
            'seq' => null,
            'server_updated_at_ms' => (int) $model->client_updated_at_ms,
        ];
    }

    private function validatePayload(string $entity, array $data): ?string
    {
        return match ($entity) {
            'unit' => trim((string) ($data['title'] ?? '')) === '' ? '单元标题不能为空' : null,
            'word' => trim((string) ($data['unit_id'] ?? $data['unit_uuid'] ?? '')) === ''
                || trim((string) ($data['word'] ?? '')) === '' ? '词条缺少单元或单词' : null,
            'practice_record' => trim((string) ($data['word_id'] ?? $data['word_uuid'] ?? '')) === ''
                || trim((string) ($data['mode'] ?? '')) === '' ? '练习记录缺少词条或模式' : null,
            'read_article' => trim((string) ($data['title'] ?? '')) === '' ? '短文标题不能为空' : null,
            'read_record' => trim((string) ($data['article_id'] ?? $data['article_uuid'] ?? '')) === ''
                ? '跟读记录缺少文章' : null,
            'study_session' => trim((string) ($data['kind'] ?? '')) === '' ? '学习会话缺少类型' : null,
            'setting' => ! is_array($data['payload'] ?? null) ? '设置内容必须是对象' : null,
            default => '未知实体',
        };
    }

    private function fillModel(string $entity, Model $model, array $data, int $clientTs, int $seq): void
    {
        $model->deleted_at = null;
        $model->client_updated_at_ms = $clientTs;
        $model->sync_seq = $seq;

        switch ($entity) {
            case 'unit':
                $model->title = trim((string) $data['title']);
                $model->source_img = (string) ($data['source_img'] ?? '');
                $model->created_at_ms = $this->intOr($data['created_at'] ?? $data['created_at_ms'] ?? 0);
                break;

            case 'word':
                $model->unit_uuid = (string) ($data['unit_id'] ?? $data['unit_uuid'] ?? '');
                $model->word = trim((string) $data['word']);
                $model->phonetic_uk = (string) ($data['phonetic_uk'] ?? '');
                $model->phonetic_us = (string) ($data['phonetic_us'] ?? '');
                $model->pos = (string) ($data['pos'] ?? '');
                $model->translation = (string) ($data['translation'] ?? '');
                $model->example = (string) ($data['example'] ?? '');
                $model->audio_path = (string) ($data['audio_path'] ?? '');
                $model->sort = $this->intOr($data['sort'] ?? 0);
                $model->wrong = $this->intOr($data['wrong'] ?? 0) === 1 ? 1 : 0;
                $model->wrong_count = max(0, $this->intOr($data['wrong_count'] ?? 0));
                break;

            case 'practice_record':
                $model->word_uuid = (string) ($data['word_id'] ?? $data['word_uuid'] ?? '');
                $model->mode = (string) ($data['mode'] ?? '');
                $model->input_type = (string) ($data['input_type'] ?? '');
                $model->raw_text = (string) ($data['raw_text'] ?? '');
                $model->asr_text = (string) ($data['asr_text'] ?? '');
                $model->score = $this->intOr($data['score'] ?? 0);
                $model->detail_json = $this->jsonText($data['detail_json'] ?? null);
                $model->created_at_ms = $this->intOr($data['created_at'] ?? $data['created_at_ms'] ?? 0);
                break;

            case 'read_article':
                $model->title = trim((string) $data['title']);
                $model->source_img = (string) ($data['source_img'] ?? '');
                $model->content = $this->jsonText($data['sentences'] ?? $data['content'] ?? []);
                $model->translations = $this->jsonText($data['translations'] ?? []);
                $model->created_at_ms = $this->intOr($data['created_at'] ?? $data['created_at_ms'] ?? 0);
                break;

            case 'read_record':
                $model->article_uuid = (string) ($data['article_id'] ?? $data['article_uuid'] ?? '');
                $model->sentence_index = max(0, $this->intOr($data['sentence_index'] ?? 0));
                $model->asr_text = (string) ($data['asr_text'] ?? '');
                $model->score = $this->intOr($data['score'] ?? 0);
                $model->detail_json = $this->jsonText($data['detail_json'] ?? null);
                $model->created_at_ms = $this->intOr($data['created_at'] ?? $data['created_at_ms'] ?? 0);
                break;

            case 'study_session':
                $model->kind = (string) ($data['kind'] ?? '');
                $model->mode = (string) ($data['mode'] ?? '');
                $model->unit_uuid = (string) ($data['unit_id'] ?? $data['unit_uuid'] ?? '');
                $model->title = (string) ($data['title'] ?? '');
                $model->started_at_ms = $this->intOr($data['started_at'] ?? $data['started_at_ms'] ?? 0);
                $model->ended_at_ms = $this->intOr($data['ended_at'] ?? $data['ended_at_ms'] ?? 0);
                $model->duration_sec = max(0, $this->intOr($data['duration_sec'] ?? 0));
                $model->total = max(0, $this->intOr($data['total'] ?? 0));
                $model->answered = max(0, $this->intOr($data['answered'] ?? 0));
                $model->passed = max(0, $this->intOr($data['passed'] ?? 0));
                $model->avg_score = $this->intOr($data['avg_score'] ?? 0);
                $model->created_at_ms = $this->intOr($data['created_at'] ?? $data['created_at_ms'] ?? 0);
                break;

            case 'setting':
                $model->payload = $this->jsonText($data['payload'] ?? []);
                break;
        }

        $model->save();
    }

    private function changeFromRow(string $entity, Model $row): array
    {
        $deleted = $row->deleted_at !== null;

        return [
            'entity' => $entity,
            'op' => $deleted ? 'delete' : 'upsert',
            'id' => $entity === 'setting' ? 'default' : $row->uuid,
            'seq' => (int) $row->sync_seq,
            'updated_at_ms' => (int) $row->client_updated_at_ms,
            'data' => $deleted ? [] : $this->payload($entity, $row),
        ];
    }

    private function payload(string $entity, Model $row): array
    {
        return match ($entity) {
            'unit' => [
                'title' => $row->title,
                'source_img' => $row->source_img,
                'created_at' => (int) $row->created_at_ms,
            ],
            'word' => [
                'unit_id' => $row->unit_uuid,
                'word' => $row->word,
                'phonetic_uk' => $row->phonetic_uk,
                'phonetic_us' => $row->phonetic_us,
                'pos' => $row->pos,
                'translation' => $row->translation,
                'example' => $row->example,
                'audio_path' => $row->audio_path,
                'sort' => (int) $row->sort,
                'wrong' => (int) $row->wrong,
                'wrong_count' => (int) $row->wrong_count,
            ],
            'practice_record' => [
                'word_id' => $row->word_uuid,
                'mode' => $row->mode,
                'input_type' => $row->input_type,
                'raw_text' => $row->raw_text,
                'asr_text' => $row->asr_text,
                'score' => (int) $row->score,
                'detail_json' => $row->detail_json,
                'created_at' => (int) $row->created_at_ms,
            ],
            'read_article' => [
                'title' => $row->title,
                'source_img' => $row->source_img,
                'sentences' => $row->sentences,
                'translations' => $row->translations_array,
                'created_at' => (int) $row->created_at_ms,
            ],
            'read_record' => [
                'article_id' => $row->article_uuid,
                'sentence_index' => (int) $row->sentence_index,
                'asr_text' => $row->asr_text,
                'score' => (int) $row->score,
                'detail_json' => $row->detail_json,
                'created_at' => (int) $row->created_at_ms,
            ],
            'study_session' => [
                'kind' => $row->kind,
                'mode' => $row->mode,
                'unit_id' => $row->unit_uuid,
                'title' => $row->title,
                'started_at' => (int) $row->started_at_ms,
                'ended_at' => (int) $row->ended_at_ms,
                'duration_sec' => (int) $row->duration_sec,
                'total' => (int) $row->total,
                'answered' => (int) $row->answered,
                'passed' => (int) $row->passed,
                'avg_score' => (int) $row->avg_score,
                'created_at' => (int) $row->created_at_ms,
            ],
            'setting' => [
                'payload' => $row->payload_array,
                'updated_at_ms' => (int) $row->client_updated_at_ms,
            ],
            default => [],
        };
    }

    private function jsonText(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_string($value)) {
            return $value;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }

    private function intOr(mixed $value, int $default = 0): int
    {
        return is_numeric($value) ? (int) $value : $default;
    }

    private function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }
}
