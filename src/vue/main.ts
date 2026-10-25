import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './studio.css';
import './battery.css';
import StudioApp from './StudioApp.vue';

createApp(StudioApp).use(ElementPlus).mount('#app');
