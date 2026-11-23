<?php

namespace Tests\Feature;

use App\Models\AppUser;
use Database\Seeders\RbacSeeder;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AiEvaluateTest extends TestCase
{
    use RefreshDatabase;

    private AppUser $user;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([RbacSeeder::class, SystemConfigSeeder::class]);

        $this->user = AppUser::create([
            'uuid' => 'au_ai_1',
            'username' => 'aiuser',
            'nickname' => 'AI 用户',
            'password' => Hash::make('aiuser123456'),
            'status' => 1,
            'next_sync_seq' => 1,
        ]);
        $this->headers = ['Authorization' => 'Bearer '.$this->user->createToken('app:test')->plainTextToken];
    }

    public function test_ai_endpoints_require_token(): void
    {
        $this->postJson('/api/v1/ai/evaluate', [])->assertStatus(401);
    }

    public function test_exact_english_answer_scores_100_without_cloud(): void
    {
        $response = $this->withHeaders($this->headers)->postJson('/api/v1/ai/evaluate', [
            'mode' => '2.2',
            'word' => ['word' => 'apple', 'translation' => '苹果'],
            'answer' => 'apple',
            'asr_text' => 'apple',
            'input_type' => 'input',
            'strictness' => 'normal',
        ])->assertOk();

        $this->assertSame(100, $response->json('data.score'));
        $this->assertFalse($response->json('data.semantic'));
    }

    public function test_homophone_is_accepted_for_content_correctness(): void
    {
        $response = $this->withHeaders($this->headers)->postJson('/api/v1/ai/evaluate', [
            'mode' => '2.2',
            'word' => ['word' => 'two', 'translation' => '二'],
            'answer' => 'to',
            'asr_text' => 'to',
            'input_type' => 'record',
            'strictness' => 'normal',
        ])->assertOk();

        $this->assertSame(100, $response->json('data.score'));
        $this->assertStringContainsString('同音', $response->json('data.feedback'));
    }

    public function test_chinese_meaning_is_scored(): void
    {
        $response = $this->withHeaders($this->headers)->postJson('/api/v1/ai/evaluate', [
            'mode' => '2.3',
            'word' => ['word' => 'apple', 'translation' => '苹果'],
            'answer' => '苹果',
            'asr_text' => '苹果',
            'input_type' => 'record',
            'strictness' => 'normal',
        ])->assertOk();

        $this->assertSame(100, $response->json('data.score'));
    }

    public function test_passage_alignment_reports_missed_words(): void
    {
        $response = $this->withHeaders($this->headers)->postJson('/api/v1/ai/passage-evaluate', [
            'expected' => 'The sun rises over the park.',
            'asr_text' => 'The sun rises over park',
        ])->assertOk();

        $this->assertGreaterThan(0, $response->json('data.score'));
        $this->assertSame(6, $response->json('data.total'));
        $this->assertNotEmpty($response->json('data.words'));
    }
}
