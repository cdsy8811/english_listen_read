<?php

namespace Database\Seeders;

use App\Models\AppSetting;
use App\Models\AppUser;
use App\Models\PracticeRecord;
use App\Models\ReadArticle;
use App\Models\ReadRecord;
use App\Models\StudySession;
use App\Models\Unit;
use App\Models\Word;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing']) || env('DEMO_SEED_ENABLED', false) === false) {
            return;
        }

        $now = (int) floor(microtime(true) * 1000);

        $user = AppUser::updateOrCreate(
            ['username' => 'demo'],
            [
                'uuid' => 'au_demo_0001',
                'nickname' => '演示账号',
                'password' => Hash::make('demo123456'),
                'status' => 1,
                'deleted_at' => null,
            ]
        );

        $unitUuid = 'u_demo_0001';
        Unit::updateOrCreate(
            ['app_user_id' => $user->id, 'uuid' => $unitUuid],
            [
                'title' => 'Unit 1 演示词表',
                'source_img' => '',
                'created_at_ms' => $now - 86400000,
                'client_updated_at_ms' => $now - 86400000,
                'sync_seq' => 1,
                'deleted_at' => null,
            ]
        );

        $words = [
            ['apple', '/ˈæpl/', 'n. 苹果', 'I ate an apple.'],
            ['orange', '/ˈɒrɪndʒ/', 'n. 橙子', 'The orange is sweet.'],
            ['listen', '/ˈlɪsn/', 'v. 听', 'Listen to me carefully.'],
            ['read', '/riːd/', 'v. 阅读', 'I read a book every night.'],
            ['practice', '/ˈpræktɪs/', 'n./v. 练习', 'Practice makes perfect.'],
        ];

        foreach ($words as $index => $word) {
            $wordUuid = 'w_demo_000'.($index + 1);
            Word::updateOrCreate(
                ['app_user_id' => $user->id, 'uuid' => $wordUuid],
                [
                    'unit_uuid' => $unitUuid,
                    'word' => $word[0],
                    'phonetic_uk' => '',
                    'phonetic_us' => $word[1],
                    'pos' => explode(' ', $word[2])[0] ?? '',
                    'translation' => $word[2],
                    'example' => $word[3],
                    'audio_path' => '',
                    'sort' => $index + 1,
                    'wrong' => $index === 1 ? 1 : 0,
                    'wrong_count' => $index === 1 ? 2 : 0,
                    'client_updated_at_ms' => $now - 3600000,
                    'sync_seq' => 2 + $index,
                    'deleted_at' => null,
                ]
            );
        }

        PracticeRecord::updateOrCreate(
            ['app_user_id' => $user->id, 'uuid' => 'pr_demo_0001'],
            [
                'word_uuid' => 'w_demo_0002',
                'mode' => '2.2',
                'input_type' => 'record',
                'raw_text' => 'orange',
                'asr_text' => 'orange',
                'score' => 100,
                'detail_json' => json_encode(['expected' => 'orange', 'answer' => 'orange']),
                'created_at_ms' => $now - 3600000,
                'client_updated_at_ms' => $now - 3600000,
                'sync_seq' => 10,
                'deleted_at' => null,
            ]
        );

        $articleUuid = 'ra_demo_0001';
        ReadArticle::updateOrCreate(
            ['app_user_id' => $user->id, 'uuid' => $articleUuid],
            [
                'title' => 'A Morning in the Park',
                'source_img' => '',
                'content' => json_encode([
                    'The sun rises over the park.',
                    'Birds sing in the trees.',
                    'People walk along the path.',
                ], JSON_UNESCAPED_UNICODE),
                'translations' => json_encode([
                    '太阳在公园上空升起。',
                    '鸟儿在树上歌唱。',
                    '人们沿着小路散步。',
                ], JSON_UNESCAPED_UNICODE),
                'created_at_ms' => $now - 7200000,
                'client_updated_at_ms' => $now - 7200000,
                'sync_seq' => 20,
                'deleted_at' => null,
            ]
        );

        ReadRecord::updateOrCreate(
            ['app_user_id' => $user->id, 'uuid' => 'rr_demo_0001'],
            [
                'article_uuid' => $articleUuid,
                'sentence_index' => 0,
                'asr_text' => 'The sun rises over the park.',
                'score' => 95,
                'detail_json' => json_encode(['hit' => 6, 'total' => 6]),
                'created_at_ms' => $now - 7200000,
                'client_updated_at_ms' => $now - 7200000,
                'sync_seq' => 21,
                'deleted_at' => null,
            ]
        );

        StudySession::updateOrCreate(
            ['app_user_id' => $user->id, 'uuid' => 'ss_demo_0001'],
            [
                'kind' => 'practice',
                'mode' => '2.2',
                'unit_uuid' => $unitUuid,
                'title' => 'Unit 1 演示词表',
                'started_at_ms' => $now - 3600000,
                'ended_at_ms' => $now - 3480000,
                'duration_sec' => 120,
                'total' => 5,
                'answered' => 4,
                'passed' => 3,
                'avg_score' => 86,
                'created_at_ms' => $now - 3480000,
                'client_updated_at_ms' => $now - 3480000,
                'sync_seq' => 30,
                'deleted_at' => null,
            ]
        );

        AppSetting::updateOrCreate(
            ['app_user_id' => $user->id],
            [
                'payload' => json_encode([
                    'speed' => 1, 'accent' => 'US', 'volume' => 80,
                    'autoPlay' => true, 'playOrder' => 'en-only', 'repeatTimes' => 1,
                    'itemGapSec' => 1.5, 'randomOrder' => false, 'advanceMode' => 'submit',
                    'waitSec' => 3, 'strictness' => 'normal', 'wrongThreshold' => 60,
                ], JSON_UNESCAPED_UNICODE),
                'client_updated_at_ms' => $now - 3600000,
                'sync_seq' => 40,
                'deleted_at' => null,
            ]
        );

        // 让演示数据的同步序号与用户游标一致，避免 pull 返回不可预期的游标。
        $user->forceFill(['next_sync_seq' => 41])->save();

        $this->command?->info('演示账号 demo / demo123456 已就绪。');
    }
}
