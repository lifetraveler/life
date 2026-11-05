/**
 * 切片 11 变更 A：数据层的设备时区读取（时区来源修正）。
 *
 * 背景：src/polyfill.ts 的 @formatjs/intl-datetimeformat 接管 Intl 后，
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` 恒返回 'UTC'
 * （slice-08/09/10 closeout 记录的时区伪影根因）。时区来源改用
 * expo-localization 的 getCalendars()：同步读取系统时区，不经过 JS Intl，
 * 不受 polyfill 影响。polyfill 本身不删不改，仅不再作为时区来源。
 *
 * src/ui/timeFormat.ts 已改为委托本实现（避免两处读时区逻辑分叉）；
 * 数据层不得 import src/ui（分层约束）。仅作为默认值使用——
 * WatermelonItemRepository 构造函数可注入替换实现，便于单测固定时区。
 */

import * as Localization from 'expo-localization';

/** dev 期 Intl 对比日志每会话只打一次，避免刷屏。 */
let intlMismatchLogged = false;

/** 设备当前 IANA 时区；取不到时回退 UTC。 */
export function getDeviceTzid(): string {
  let tzid = 'UTC';
  try {
    tzid = Localization.getCalendars()[0]?.timeZone ?? 'UTC';
  } catch {
    tzid = 'UTC';
  }
  if (__DEV__ && !intlMismatchLogged) {
    intlMismatchLogged = true;
    try {
      const intlTzid = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (intlTzid !== tzid) {
        console.warn(
          `[slice-11] getDeviceTzid=${tzid} 与 Intl=${intlTzid} 不一致` +
            '（@formatjs 接管 Intl 的已知伪影），以 expo-localization 为准',
        );
      }
    } catch {
      // Intl 不可用时跳过对比，不影响主路径
    }
  }
  return tzid;
}
