<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\RbacSeeder;
use Database\Seeders\SystemConfigSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminAuthTest extends TestCase
{
    use RefreshDatabase;

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
    }

    public function test_admin_can_login_and_fetch_me(): void
    {
        $login = $this->postJson('/api/admin/auth/login', [
            'username' => 'admin',
            'password' => 'admin123456',
        ])->assertOk()->assertJsonPath('code', 200);

        $token = $login->json('data.access_token');
        $this->assertNotEmpty($token);

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/admin/auth/me')
            ->assertOk()
            ->assertJsonPath('data.username', 'admin')
            ->assertJsonPath('data.permissions.0', '*');
    }

    public function test_wrong_password_is_rejected(): void
    {
        $this->postJson('/api/admin/auth/login', [
            'username' => 'admin',
            'password' => 'bad-password',
        ])->assertStatus(422)->assertJsonPath('code', 3000);
    }

    public function test_admin_api_requires_token(): void
    {
        $this->getJson('/api/admin/dashboard')->assertStatus(401);
    }
}
