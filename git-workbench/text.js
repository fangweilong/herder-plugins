// 字体与字号：默认跟随 Herdr 的界面设置；布局 props 可以单独覆盖。
//
// 界面基准字号来自 settings().ui_font_size（Herdr 内置界面是 13），也是本 mod 的设计基准，
// 所有字号与依赖字号的尺寸都经 fs() 等比缩放；代码区域另用 Herdr 的终端字体。

import { props, settings } from "herdr";

/** 设计稿的基准字号，放大/缩小的分母；与 Herdr 内置界面一致。 */
const DESIGN_SIZE = 13;
/** settings() 取不到界面字号时的兜底。 */
const DEFAULT_SIZE = 13;

function hostSettings() {
  const value = settings();
  return value && typeof value === "object" ? value : {};
}

function ownProps() {
  const value = props();
  return value && typeof value === "object" ? value : {};
}

function positive(value) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function family(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 界面基准字号：布局 props.font_size → Herdr 的 ui_font_size → 13。
 * @returns {number} 像素字号。
 */
export function uiFontSize() {
  return positive(ownProps().font_size) ?? positive(hostSettings().ui_font_size) ?? DEFAULT_SIZE;
}

/**
 * 按 Herdr 界面字号缩放设计稿里的字号或尺寸。
 * @param {number} design 设计稿中的像素值。
 * @returns {number} 当前应使用的像素值。
 */
export function fs(design) {
  return Math.round((design * uiFontSize() / DESIGN_SIZE) * 100) / 100;
}

/**
 * 界面字体：布局 props.font_family → Herdr 的 ui_font_family。
 * @returns {string|null} 字体名；null 表示沿用宿主默认字体。
 */
export function uiFontFamily() {
  return family(ownProps().font_family) ?? family(hostSettings().ui_font_family);
}

/**
 * 代码字体（diff、hash、blame）：props.mono_font_family → Herdr 的终端字体。
 * @returns {string} 字体名。
 */
export function monoFontFamily() {
  return family(ownProps().mono_font_family) ?? family(hostSettings().font_family) ?? "JetBrains Mono";
}
