<?php

namespace Tests\Feature;

use App\Models\AppUser;
use Database\Seeders\RbacSeeder;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AppSyncTest extends TestCase
{
    use RefreshDatabase;

    private AppUser $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([RbacSeeder::class, SystemConfigSeeder::class]);

        $this->user = AppUser::create([
            'uuid' => 'au_test_1',
            'username' => 'tester',
            'nickname' => '测试',
            'password' => Hash::make('tester123456'),
            'status' => 1,
            'next_sync_seq' => 1,
        ]);
    }

    private function appToken(AppUser $user): array
    {
        return ['Authorization' => 'Bearer '.$user->createToken('app:test')->plainTextToken];
    }

    private function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    public function test_app_login_returns_cursor_and_token(): void
    {
        $this->postJson('/api/v1/auth/login', [
            'username' => 'tester',
            'password' => 'tester123456',
            'device_id' => 'device-1',
            'device_name' => '测试设备',
        ])->assertOk()
            ->assertJsonPath('code', 200)
            ->assertJsonPath('data.user.username', 'tester')
            ->assertJsonPath('data.sync.cursor', 0);
    }

    public function test_push_then_pull_returns_changes(): void
    {
        $headers = $this->appToken($this->user);
        $now = $this->nowMs();

        $push = $this->withHeaders($headers)->postJson('/api/v1/sync/push', [
            'changes' => [
                [
                    'entity' => 'unit', 'op' => 'upsert', 'id' => 'u_1',
                    'client_updated_at_ms' => $now,
                    'data' => ['title' => 'Unit 1', 'source_img' => '', 'created_at' => $now],
                ],
                [
                    'entity' => 'word', 'op' => 'upsert', 'id' => 'w_1',
                    'client_updated_at_ms' => $now,
                    'data' => ['unit_id' => 'u_1', 'word' => 'apple', 'translation' => '苹果'],
                ],
            ],
        ])->assertOk();

        $this->assertSame(2, $push->json('data.next_cursor'));
        $this->assertSame('applied', $push->json('data.results.0.status'));

        $pull = $this->withHeaders($headers)
            ->getJson('/api/v1/sync/pull?cursor=0&limit=100')
            ->assertOk();

        $this->assertCount(2, $pull->json('data.changes'));
        $this->assertSame('unit', $pull->json('data.changes.0.entity'));
        $this->assertSame('u_1', $pull->json('data.changes.0.id'));
        $this->assertSame('word', $pull->json('data.changes.1.entity'));
        $this->assertSame(2, $pull->json('data.next_cursor'));
    }

    public function test_data_is_isolated_between_accounts(): void
    {
        $other = AppUser::create([
            'uuid' => 'au_test_2',
            'username' => 'other',
            'nickname' => '其他',
            'password' => Hash::make('other123456'),
            'status' => 1,
            'next_sync_seq' => 1,
        ]);

        $now = $this->nowMs();
        $this->withHeaders($this->appToken($this->user))->postJson('/api/v1/sync/push', [
            'changes' => [[
                'entity' => 'unit', 'op' => 'upsert', 'id' => 'u_private',
                'client_updated_at_ms' => $now,
                'data' => ['title' => '私有单元', 'source_img' => '', 'created_at' => $now],
            ]],
        ])->assertOk();

        $otherHeaders = $this->appToken($other);
        $this->app['auth']->forgetGuards();
        $me = $this->withHeaders($otherHeaders)->getJson('/api/v1/auth/me')->assertOk();
        $this->assertSame('other', $me->json('data.user.username'));

        $otherPull = $this->withHeaders($otherHeaders)
            ->getJson('/api/v1/sync/pull?cursor=0&limit=100')
            ->assertOk();

        $this->assertCount(0, $otherPull->json('data.changes'), json_encode($otherPull->json('data.changes')));
    }

    public function test_older_update_is_stale(): void
    {
        $headers = $this->appToken($this->user);
        $now = $this->nowMs();

        $this->withHeaders($headers)->postJson('/api/v1/sync/push', [
            'changes' => [[
                'entity' => 'unit', 'op' => 'upsert', 'id' => 'u_1',
                'client_updated_at_ms' => $now,
                'data' => ['title' => '新标题', 'source_img' => '', 'created_at' => $now],
            ]],
        ])->assertOk();

        $stale = $this->withHeaders($headers)->postJson('/api/v1/sync/push', [
            'changes' => [[
                'entity' => 'unit', 'op' => 'upsert', 'id' => 'u_1',
                'client_updated_at_ms' => $now - 1000,
                'data' => ['title' => '旧标题', 'source_img' => '', 'created_at' => $now - 1000],
            ]],
        ])->assertOk();

        $this->assertSame('stale', $stale->json('data.results.0.status'));

        $this->assertDatabaseHas('units', ['uuid' => 'u_1', 'title' => '新标题']);
    }

    public function test_delete_is_returned_as_tombstone(): void
    {
        $headers = $this->appToken($this->user);
        $now = $this->nowMs();

        $this->withHeaders($headers)->postJson('/api/v1/sync/push', [
            'changes' => [
                [
                    'entity' => 'unit', 'op' => 'upsert', 'id' => 'u_1',
                    'client_updated_at_ms' => $now,
                    'data' => ['title' => '待删除', 'source_img' => '', 'created_at' => $now],
                ],
                [
                    'entity' => 'unit', 'op' => 'delete', 'id' => 'u_1',
                    'client_updated_at_ms' => $now + 1000,
                ],
            ],
        ])->assertOk();

        $pull = $this->withHeaders($headers)
            ->getJson('/api/v1/sync/pull?cursor=0&limit=100')
            ->assertOk();

        $this->assertSame('delete', $pull->json('data.changes.0.op'));
        $this->assertSame('u_1', $pull->json('data.changes.0.id'));
    }

    public function test_pull_paginates_without_losing_rows(): void
    {
        $headers = $this->appToken($this->user);
        $now = $this->nowMs();

        $changes = [];
        foreach (range(1, 3) as $i) {
            $changes[] = [
                'entity' => 'unit', 'op' => 'upsert', 'id' => 'u_'.$i,
                'client_updated_at_ms' => $now + $i,
                'data' => ['title' => 'Unit '.$i, 'source_img' => '', 'created_at' => $now + $i],
            ];
        }

        $this->withHeaders($headers)->postJson('/api/v1/sync/push', ['changes' => $changes])->assertOk();

        $first = $this->withHeaders($headers)->getJson('/api/v1/sync/pull?cursor=0&limit=2')->assertOk();
        $this->assertCount(2, $first->json('data.changes'));
        $this->assertTrue($first->json('data.has_more'));

        $second = $this->withHeaders($headers)
            ->getJson('/api/v1/sync/pull?cursor='.$first->json('data.next_cursor').'&limit=2')
            ->assertOk();

        $this->assertCount(1, $second->json('data.changes'));
        $this->assertSame('u_3', $second->json('data.changes.0.id'));
    }

    public function test_app_token_cannot_access_admin_api(): void
    {
        $token = $this->user->createToken('app:test')->plainTextToken;

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/admin/dashboard')
            ->assertStatus(401);
    }
}
