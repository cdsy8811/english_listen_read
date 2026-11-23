<?php

namespace Tests\Feature;

use App\Models\AppUser;
use App\Models\SystemConfig;
use App\Services\Ai\TtsService;
use Database\Seeders\RbacSeeder;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AiQuotaAndTtsTest extends TestCase
{
    use RefreshDatabase;

    private AppUser $user;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([RbacSeeder::class, SystemConfigSeeder::class]);

        $this->user = AppUser::create([
            'uuid' => 'au_quota_1',
            'username' => 'quota',
            'nickname' => '配额用户',
            'password' => Hash::make('quota123456'),
            'status' => 1,
            'next_sync_seq' => 1,
        ]);
        $this->headers = ['Authorization' => 'Bearer '.$this->user->createToken('app:test')->plainTextToken];
    }

    public function test_daily_quota_returns_429_after_limit(): void
    {
        SystemConfig::updateOrCreate(['key' => 'ai_daily_quota'], ['value' => '1', 'group' => 'ai']);

        $payload = [
            'mode' => '2.2',
            'word' => ['word' => 'apple', 'translation' => '苹果'],
            'answer' => 'apple',
            'input_type' => 'input',
        ];

        $this->withHeaders($this->headers)->postJson('/api/v1/ai/evaluate', $payload)->assertOk();
        $this->withHeaders($this->headers)->postJson('/api/v1/ai/evaluate', $payload)
            ->assertStatus(429)
            ->assertJsonPath('code', 4029)
            ->assertJsonStructure(['data' => ['retry_after']]);
    }

    public function test_tts_returns_audio_and_supports_etag(): void
    {
        $this->mock(TtsService::class, function ($mock) {
            $mock->shouldReceive('synthesize')->twice()->andReturn([
                'bytes' => 'ID3-fake-mp3',
                'hash' => str_repeat('a', 64),
                'cached' => false,
                'path' => 'tts/aa/fake.mp3',
                'lang' => 'en',
                'vcn' => 'x5_EnUs_Lila_flow',
                'speed' => 50,
            ]);
        });

        $response = $this->withHeaders($this->headers)->postJson('/api/v1/ai/tts', [
            'text' => 'apple',
            'lang' => 'en',
            'speed' => 1.0,
        ])->assertOk();

        $response->assertHeader('Content-Type', 'audio/mpeg');
        $this->assertSame('MISS', $response->headers->get('X-Cache'));
        $etag = $response->headers->get('ETag');
        $this->assertNotEmpty($etag);

        $this->withHeaders(array_merge($this->headers, ['If-None-Match' => $etag]))
            ->postJson('/api/v1/ai/tts', ['text' => 'apple', 'lang' => 'en', 'speed' => 1.0])
            ->assertStatus(304);
    }
}
