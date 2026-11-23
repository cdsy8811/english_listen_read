<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

class RbacSeeder extends Seeder
{
    public function run(): void
    {
        $tree = [
            [
                'code' => 'dashboard', 'name' => '工作台', 'type' => 'menu',
                'path' => '/', 'icon' => 'HomeFilled', 'component_path' => 'Index', 'sort' => 1,
            ],
            [
                'code' => 'app_user', 'name' => 'App 用户', 'type' => 'menu',
                'path' => '/app-users', 'icon' => 'User', 'component_path' => 'app-user/Index', 'sort' => 10,
                'children' => [
                    ['code' => 'app_user:add', 'name' => '新增用户'],
                    ['code' => 'app_user:edit', 'name' => '编辑用户'],
                    ['code' => 'app_user:remove', 'name' => '删除用户'],
                    ['code' => 'app_user:reset_password', 'name' => '重置密码'],
                ],
            ],
            [
                'code' => 'library', 'name' => '词库', 'type' => 'menu',
                'path' => '/library', 'icon' => 'Collection', 'component_path' => 'library/Unit', 'sort' => 20,
                'children' => [
                    ['code' => 'library:add', 'name' => '新增单元'],
                    ['code' => 'library:edit', 'name' => '编辑词条'],
                    ['code' => 'library:remove', 'name' => '删除词条'],
                    ['code' => 'library:export', 'name' => '导出词库'],
                ],
            ],
            [
                'code' => 'read', 'name' => '跟读', 'type' => 'menu',
                'path' => '/read', 'icon' => 'Reading', 'component_path' => 'read/Article', 'sort' => 30,
                'children' => [
                    ['code' => 'read:remove', 'name' => '删除文章'],
                ],
            ],
            [
                'code' => 'practice_record', 'name' => '练习记录', 'type' => 'menu',
                'path' => '/practice-records', 'icon' => 'EditPen', 'component_path' => 'practice/Record', 'sort' => 40,
            ],
            [
                'code' => 'study_session', 'name' => '学习统计', 'type' => 'menu',
                'path' => '/study-sessions', 'icon' => 'DataLine', 'component_path' => 'study/Session', 'sort' => 50,
            ],
            [
                'code' => 'ai', 'name' => 'AI 用量', 'type' => 'menu',
                'path' => '/ai', 'icon' => 'MagicStick', 'component_path' => '', 'sort' => 60,
                'children' => [
                    ['code' => 'ai:call_log', 'name' => '调用日志', 'type' => 'menu', 'path' => '/ai/call-logs', 'component_path' => 'ai/CallLog', 'sort' => 61],
                    ['code' => 'ai:tts_cache', 'name' => '音频缓存', 'type' => 'menu', 'path' => '/ai/tts-cache', 'component_path' => 'ai/Cache', 'sort' => 62],
                ],
            ],
            [
                'code' => 'system', 'name' => '系统管理', 'type' => 'menu',
                'path' => '/system', 'icon' => 'Setting', 'component_path' => '', 'sort' => 90,
                'children' => [
                    ['code' => 'system:user', 'name' => '管理员', 'type' => 'menu', 'path' => '/system/users', 'component_path' => 'system/User', 'sort' => 91],
                    ['code' => 'system:role', 'name' => '角色', 'type' => 'menu', 'path' => '/system/roles', 'component_path' => 'system/Role', 'sort' => 92],
                    ['code' => 'system:permission', 'name' => '权限菜单', 'type' => 'menu', 'path' => '/system/permissions', 'component_path' => 'system/Permission', 'sort' => 93],
                    ['code' => 'system:log', 'name' => '日志', 'type' => 'menu', 'path' => '/system/logs', 'component_path' => 'system/Log', 'sort' => 94],
                    ['code' => 'system:config', 'name' => '系统配置', 'type' => 'menu', 'path' => '/system/configs', 'component_path' => 'system/Config', 'sort' => 95],
                    ['code' => 'system:user:add', 'name' => '新增管理员'],
                    ['code' => 'system:user:edit', 'name' => '编辑管理员'],
                    ['code' => 'system:user:remove', 'name' => '删除管理员'],
                    ['code' => 'system:role:edit', 'name' => '编辑角色'],
                    ['code' => 'system:permission:edit', 'name' => '编辑权限'],
                ],
            ],
        ];

        $this->seedTree($tree, 0);

        $super = Role::updateOrCreate(
            ['code' => 'super_admin'],
            ['name' => '超级管理员', 'description' => '拥有全部权限', 'status' => 1]
        );
        $super->permissions()->sync(Permission::pluck('id')->all());

        $operator = Role::updateOrCreate(
            ['code' => 'operator'],
            ['name' => '运营', 'description' => '只读运营数据', 'status' => 1]
        );
        $operatorCodes = [
            'dashboard', 'app_user', 'library', 'read', 'practice_record',
            'study_session', 'ai', 'ai:call_log', 'ai:tts_cache',
        ];
        $operator->permissions()->sync(
            Permission::whereIn('code', $operatorCodes)->pluck('id')->all()
        );
    }

    private function seedTree(array $items, int $parentId): void
    {
        foreach ($items as $index => $item) {
            $permission = Permission::updateOrCreate(
                ['code' => $item['code']],
                [
                    'parent_id' => $parentId,
                    'name' => $item['name'],
                    'type' => $item['type'] ?? 'action',
                    'path' => $item['path'] ?? '',
                    'icon' => $item['icon'] ?? '',
                    'component_path' => $item['component_path'] ?? '',
                    'sort' => $item['sort'] ?? (($index + 1) * 10),
                    'status' => 1,
                    'deleted_at' => null,
                ]
            );

            if (! empty($item['children'])) {
                $this->seedTree($item['children'], (int) $permission->id);
            }
        }
    }
}
