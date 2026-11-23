<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\RbacSeeder;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminApiTest extends TestCase
{
    use RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([RbacSeeder::class, SystemConfigSeeder::class]);

        $admin = User::create([
            'username' => 'admin',
            'nickname' => '超级管理员',
            'password' => Hash::make('admin123456'),
            'status' => 1,
        ]);
        $admin->roles()->sync([Role::where('code', 'super_admin')->value('id')]);

        $this->headers = ['Authorization' => 'Bearer '.$admin->createToken('admin:test')->plainTextToken];
    }

    public function test_admin_can_create_app_user_and_library(): void
    {
        $user = $this->withHeaders($this->headers)->postJson('/api/admin/app-users', [
            'username' => 'student1',
            'password' => 'student123456',
            'nickname' => '学生一',
            'status' => 1,
        ])->assertOk()->json('data');

        $this->withHeaders($this->headers)->getJson('/api/admin/app-users')->assertOk()
            ->assertJsonPath('data.total', 1);

        $unit = $this->withHeaders($this->headers)->postJson('/api/admin/library/units', [
            'app_user_id' => $user['id'],
            'title' => 'Unit 1',
        ])->assertOk()->json('data');

        $this->withHeaders($this->headers)->postJson('/api/admin/library/units/'.$unit['id'].'/words', [
            'word' => 'apple',
            'translation' => '苹果',
            'sort' => 1,
        ])->assertOk();

        $this->withHeaders($this->headers)->getJson('/api/admin/library/units')->assertOk()
            ->assertJsonPath('data.list.0.words_count', 1);

        $this->withHeaders($this->headers)->getJson('/api/admin/dashboard')->assertOk()
            ->assertJsonPath('data.counts.app_users', 1)
            ->assertJsonPath('data.counts.words', 1);
    }

    public function test_admin_can_read_and_update_configs(): void
    {
        $this->withHeaders($this->headers)->getJson('/api/admin/system/configs')->assertOk()
            ->assertJsonStructure(['data' => ['basic', 'ai']]);

        $this->withHeaders($this->headers)->postJson('/api/admin/system/configs', [
            'items' => [['key' => 'site_name', 'value' => '橙子英语测试', 'group' => 'basic']],
        ])->assertOk();

        $this->assertDatabaseHas('system_configs', ['key' => 'site_name', 'value' => '橙子英语测试']);
    }

    public function test_admin_user_cannot_be_deleted(): void
    {
        $this->withHeaders($this->headers)->deleteJson('/api/admin/system/users/1')
            ->assertStatus(422);
    }
}
