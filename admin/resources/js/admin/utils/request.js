import axios from 'axios';
import { ElMessage } from 'element-plus';

const service = axios.create({
    baseURL: '/api/admin',
    timeout: 120000,
});

service.interceptors.request.use((config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

function redirectToLogin() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    if (window.location.pathname !== '/admin/login') {
        window.location.href = '/admin/login';
    }
}

service.interceptors.response.use(
    (response) => {
        if (response.config?.return_response) {
            return response;
        }

        const responseType = String(response.config?.responseType || '').toLowerCase();
        if (responseType === 'blob' || responseType === 'arraybuffer') {
            return response.data;
        }

        const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
        if (contentType.includes('text/csv') || contentType.includes('application/octet-stream')) {
            return response.data;
        }

        const res = response.data;
        if (res.code !== 200) {
            if (!response.config?.silent_error) {
                ElMessage.error(res.msg || '请求失败');
            }
            return Promise.reject(new Error(res.msg || '请求失败'));
        }
        return res;
    },
    (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.msg || error.message || '网络错误';

        if (status === 401) {
            redirectToLogin();
        }

        if (!error.config?.silent_error) {
            ElMessage.error(message);
        }

        return Promise.reject(error);
    }
);

export default service;
