import 'element-plus/dist/index.css';
import '../../css/app.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

import App from './App.vue';
import router from './router';
import permission from './directives/permission';

const app = createApp(App);

Object.entries(ElementPlusIconsVue).forEach(([name, component]) => {
    app.component(name, component);
});

app.directive('permission', permission);
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
