import { hasPermission } from '@admin/utils/permission';

export default {
    mounted(el, binding) {
        const code = binding.value;
        if (code && !hasPermission(code)) {
            el.parentNode?.removeChild(el);
        }
    },
};
