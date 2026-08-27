import { getLocales } from "expo-localization";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  "zh-CN": {
    translation: {
      common: { appName: "OhMyCode", back: "返回", retry: "重试" },
      auth: {
        loginTitle: "欢迎回来",
        loginSubtitle: "继续你的 OhMyCode 对话。",
        registerTitle: "注册 OhMyCode",
        registerSubtitle: "创建账户，并开始构建。",
        email: "邮箱",
        emailPlaceholder: "输入邮箱",
        name: "用户名",
        namePlaceholder: "输入用户名",
        password: "密码",
        passwordPlaceholder: "输入密码",
        login: "登录",
        register: "创建账户",
        toRegister: "还没有账户？创建账户",
        toLogin: "已有账户？返回登录",
        invalidCredentials: "邮箱或密码不正确",
        emailExists: "该邮箱已注册",
        networkError: "网络连接失败，请稍后重试",
        validationError: "请检查填写的内容",
      },
      home: {
        eyebrow: "MOBILE WORKSPACE",
        title: "你的对话",
        subtitle: "随时继续思考，复杂的本地执行仍交给桌面端。",
        emptyTitle: "还没有移动端对话",
        emptyDescription: "从一个问题开始，随时随地继续对话。",
        newChat: "新对话",
        signOut: "退出登录",
      },
      chat: {
        newTitle: "新对话",
        placeholder: "输入消息",
        send: "发送",
        stop: "停止",
        empty: "发送一条消息开始对话",
        failed: "消息发送失败，请稍后重试",
        modelMissing: "请先在桌面端配置模型",
      },
    },
  },
  en: {
    translation: {
      common: { appName: "OhMyCode", back: "Back", retry: "Retry" },
      auth: {
        loginTitle: "Welcome back",
        loginSubtitle: "Continue your OhMyCode conversations.",
        registerTitle: "Join OhMyCode",
        registerSubtitle: "Create an account and start building.",
        email: "Email",
        emailPlaceholder: "Enter your email",
        name: "Name",
        namePlaceholder: "Enter your name",
        password: "Password",
        passwordPlaceholder: "Enter your password",
        login: "Sign in",
        register: "Create account",
        toRegister: "New here? Create an account",
        toLogin: "Already have an account? Sign in",
        invalidCredentials: "Incorrect email or password",
        emailExists: "This email is already registered",
        networkError: "Network connection failed. Try again later.",
        validationError: "Check the information you entered",
      },
      home: {
        eyebrow: "MOBILE WORKSPACE",
        title: "Your conversations",
        subtitle: "Keep thinking anywhere; leave local execution to desktop.",
        emptyTitle: "No mobile conversations yet",
        emptyDescription: "Start with a question and continue the conversation anywhere.",
        newChat: "New chat",
        signOut: "Sign out",
      },
      chat: {
        newTitle: "New chat",
        placeholder: "Message OhMyCode",
        send: "Send",
        stop: "Stop",
        empty: "Send a message to begin",
        failed: "Message failed. Try again later.",
        modelMissing: "Configure a model from the desktop app first",
      },
    },
  },
} as const;

const language = getLocales()[0]?.languageCode === "zh" ? "zh-CN" : "en";
const i18nInstance = createInstance();
void i18nInstance.use(initReactI18next).init({
  compatibilityJSON: "v4",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  lng: language,
  resources,
});

export default i18nInstance;
