import { useUserStore } from '@admin/stores/user';

export function hasPermission(code) {
    if (!code) return true;

    const store = useUserStore();
    const permissions = store.user?.permissions || [];

    if (permissions.includes('*')) return true;

    return permissions.includes(code);
}

export function checkAnyPermission(codes = []) {
    if (!codes.length) return true;
    return codes.some((code) => hasPermission(code));
}
