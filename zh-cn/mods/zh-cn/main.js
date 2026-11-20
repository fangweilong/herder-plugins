// Herdr 中文语言包：Herdr 每次启动都会用自带内容还原 frame/ 和内置 mods/，
// 所以补丁在窗口加载后（由中文布局里的隐形浮动块触发）就地翻译这些文件。
// 规则按“英文原文 -> 中文”保存在 patches.json：Herdr 升级后原文件变了，
// 能匹配上的片段继续翻译，匹配不上的保留英文，不绑定版本、不会写坏新界面。
//
// 具体文件操作在 apply.js；语言设置为 English 时跳过翻译，但仍注入语言选项。

import { View, div } from "gpui-kit";
import { appHome, notify } from "herdr";
import { applyPatch, readLanguage } from "./apply.js";


export default class ZhPack extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      const home = appHome();
      try {
        const language = await readLanguage(`${home}/mods/zh-cn`);
        const result = await applyPatch(home, language);
        if (result.injectFailed) {
          notify({
            title: "语言设置项加载失败",
            body: "Herdr 的设置界面结构已变化，暂时无法注入语言选项。",
            level: "error",
            timeout: 12000,
          });
        }
        if (language === "en") {
          console.log("zh-cn: 当前语言设置为 English，跳过翻译");
        } else {
          console.log(`zh-cn: ${result.applied} 条规则已应用，${result.missed} 条未匹配（可能是 Herdr 新版本的改动）`);
        }
      } catch (error) {
        notify({
          title: "中文语言包应用失败",
          body: String(error?.message ?? error),
          level: "error",
          timeout: 12000,
        });
      }
    });
  }

  render() {
    return div();
  }
}
