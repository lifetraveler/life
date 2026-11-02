/**
 * Hermes Intl polyfill（AGENTS.md §4.21，切片 4 遗留风险处理）。
 *
 * - 必须在 app 入口最早处导入（_layout.tsx 第一行），早于任何依赖
 *   Intl.DateTimeFormat(timeZone) 的模块（@date-fns/tz → expandOccurrences）。
 * - @formatjs 各 polyfill 入口自带 shouldPolyfill() 守卫：Jest（Node 完整 Intl）
 *   下为 no-op；Hermes（默认缺 timeZone 支持）下才打补丁。
 *   本文件只被 src/app 入口导入，Jest 测试链路不经过它（§4.21：不得影响 Jest）。
 * - add-golden-tz：polyfill 需要显式注入时区数据；golden 集（784K）覆盖
 *   Asia/Shanghai 与 America/New_York（真机验收要求的两个时区），
 *   比 add-all-tz（1.4M，含全部别名）更小。
 * - locale data（zh/en）必须在 polyfill 之后导入，依赖其安装的 __addLocaleData。
 */
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-datetimeformat/polyfill';
import '@formatjs/intl-datetimeformat/add-golden-tz';
import '@formatjs/intl-datetimeformat/locale-data/zh';
import '@formatjs/intl-datetimeformat/locale-data/en';
