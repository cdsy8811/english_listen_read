import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '@admin/layouts/MainLayout.vue';
import { useUserStore } from '@admin/stores/user';

const routes = [
    {
        path: '/login',
        name: 'Login',
        component: () => import('@admin/pages/auth/Login.vue'),
        meta: { title: '登录', public: true },
    },
    {
        path: '/',
        component: MainLayout,
        children: [
            { path: '', name: 'Dashboard', component: () => import('@admin/pages/Index.vue'), meta: { title: '工作台' } },
            { path: 'app-users', name: 'AppUsers', component: () => import('@admin/pages/app-user/Index.vue'), meta: { title: 'App 用户' } },
            { path: 'app-users/:id', name: 'AppUserDetail', component: () => import('@admin/pages/app-user/Detail.vue'), meta: { title: '用户详情' } },
            { path: 'library', name: 'Library', component: () => import('@admin/pages/library/Unit.vue'), meta: { title: '词库' } },
            { path: 'read', name: 'ReadArticles', component: () => import('@admin/pages/read/Article.vue'), meta: { title: '跟读' } },
            { path: 'practice-records', name: 'PracticeRecords', component: () => import('@admin/pages/practice/Record.vue'), meta: { title: '练习记录' } },
            { path: 'study-sessions', name: 'StudySessions', component: () => import('@admin/pages/study/Session.vue'), meta: { title: '学习统计' } },
            { path: 'ai/call-logs', name: 'AiCallLogs', component: () => import('@admin/pages/ai/CallLog.vue'), meta: { title: 'AI 调用日志' } },
            { path: 'ai/tts-cache', name: 'AiTtsCache', component: () => import('@admin/pages/ai/Cache.vue'), meta: { title: '音频缓存' } },
            { path: 'system/users', name: 'SystemUsers', component: () => import('@admin/pages/system/User.vue'), meta: { title: '管理员' } },
            { path: 'system/roles', name: 'SystemRoles', component: () => import('@admin/pages/system/Role.vue'), meta: { title: '角色' } },
            { path: 'system/permissions', name: 'SystemPermissions', component: () => import('@admin/pages/system/Permission.vue'), meta: { title: '权限菜单' } },
            { path: 'system/logs', name: 'SystemLogs', component: () => import('@admin/pages/system/Log.vue'), meta: { title: '日志' } },
            { path: 'system/configs', name: 'SystemConfigs', component: () => import('@admin/pages/system/Config.vue'), meta: { title: '系统配置' } },
            { path: ':pathMatch(.*)*', name: 'NotFound', component: () => import('@admin/pages/NotFound.vue'), meta: { title: '页面不存在' } },
        ],
    },
];

const router = createRouter({
    history: createWebHistory('/admin'),
    routes,
    scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
    document.title = to.meta.title ? `${to.meta.title} - 橙子英语` : '橙子英语 · 管理后台';

    const store = useUserStore();
    const token = localStorage.getItem('admin_token');

    if (to.meta.public) {
        if (token && to.path === '/login') {
            return '/';
        }
        return true;
    }

    if (!token) {
        return { path: '/login', query: { redirect: to.fullPath } };
    }

    if (!store.user) {
        try {
            await store.initUser();
        } catch (e) {
            await store.logout();
            return { path: '/login' };
        }
    }

    return true;
});

export default router;
