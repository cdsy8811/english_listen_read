import { defineStore } from 'pinia';
import request from '@admin/utils/request';

function normalizeUser(user) {
    const normalized = user && typeof user === 'object' ? { ...user } : {};
    normalized.permissions = Array.isArray(normalized.permissions) ? normalized.permissions : [];
    normalized.roles = Array.isArray(normalized.roles) ? normalized.roles : [];
    normalized.menus = Array.isArray(normalized.menus) ? normalized.menus : [];
    return normalized;
}

export const useUserStore = defineStore('user', {
    state: () => ({
        token: localStorage.getItem('admin_token') || '',
        user: (() => {
            try {
                return normalizeUser(JSON.parse(localStorage.getItem('admin_user') || 'null'));
            } catch (e) {
                return null;
            }
        })(),
    }),

    getters: {
        siteName: (state) => state.user?.site?.name || '橙子英语',
        siteDescription: (state) => state.user?.site?.description || '英语听读 App 云端管理后台',
        displayName: (state) => state.user?.nickname || state.user?.username || '管理员',
        menus: (state) => state.user?.menus || [],
    },

    actions: {
        persistAuth(token, user) {
            this.token = token || '';
            this.user = normalizeUser(user);
            localStorage.setItem('admin_token', this.token);
            localStorage.setItem('admin_user', JSON.stringify(this.user || {}));
        },

        async login(credentials) {
            const res = await request.post('/auth/login', credentials);
            this.persistAuth(res.data.access_token, res.data.user);
            return res;
        },

        async initUser() {
            const res = await request.get('/auth/me', { silent_error: true });
            this.user = normalizeUser(res.data);
            localStorage.setItem('admin_user', JSON.stringify(this.user || {}));
            return res;
        },

        async logout() {
            try {
                await request.post('/auth/logout', {}, { silent_error: true });
            } catch (e) {
                // 忽略退出失败
            }
            this.token = '';
            this.user = null;
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_user');
        },
    },
});
