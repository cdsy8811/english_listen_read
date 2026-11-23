<?php

namespace Tests\Feature;

use App\Models\AppUser;
use App\Services\Ai\XfyunHttp;
use App\Services\Ai\XfyunWebSocket;
use Database\Seeders\RbacSeeder;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AiProxyTest extends TestCase
{
    use RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([RbacSeeder::class, SystemConfigSeeder::class]);

        $user = AppUser::create([
            'uuid' => 'au_proxy_1',
            'username' => 'proxyuser',
            'nickname' => '代理用户',
            'password' => Hash::make('proxy123456'),
            'status' => 1,
            'next_sync_seq' => 1,
        ]);
        $this->headers = ['Authorization' => 'Bearer '.$user->createToken('app:test')->plainTextToken];
    }

    public function test_ocr_accepts_base64_json(): void
    {
        $this->mock(XfyunHttp::class, function ($mock) {
            $mock->shouldReceive('ocr')->once()->andReturn('# Unit 1');
        });

        $this->withHeaders($this->headers)->postJson('/api/v1/ai/ocr', [
            'image_base64' => base64_encode('fake-image-bytes'),
            'encoding' => 'jpg',
        ])->assertOk()->assertJsonPath('data.markdown', '# Unit 1');
    }

    public function test_asr_accepts_base64_json(): void
    {
        $this->mock(XfyunWebSocket::class, function ($mock) {
            $mock->shouldReceive('asr')->once()->andReturn('hello world');
        });

        $this->withHeaders($this->headers)->postJson('/api/v1/ai/asr', [
            'audio_base64' => base64_encode('fake-mp3-bytes'),
            'lang' => 'en',
        ])->assertOk()->assertJsonPath('data.text', 'hello world');
    }

    public function test_ocr_requires_image_or_base64(): void
    {
        $this->withHeaders($this->headers)->postJson('/api/v1/ai/ocr', [])
            ->assertStatus(422)
            ->assertJsonPath('code', 3000);
    }
}
