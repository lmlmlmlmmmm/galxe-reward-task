import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import AuthApp from './AuthApp.vue'
import './styles.css'

createApp(AuthApp).use(ElementPlus).mount('#app')
