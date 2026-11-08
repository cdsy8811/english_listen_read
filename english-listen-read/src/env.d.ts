/// <reference types="vite/client" />

// 仅补充本项目用到的 Vite 内置环境变量类型（不引入任何 VITE_ 前缀密钥）
interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
}
