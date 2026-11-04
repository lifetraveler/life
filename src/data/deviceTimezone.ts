/**
 * 切片 8：数据层的设备时区读取。
 *
 * 与 src/ui/timeFormat.ts 的 getDeviceTzid 同语义（`Intl.DateTimeFormat()
 * .resolvedOptions().timeZone`，取不到时回退 UTC），但数据层不得 import
 * src/ui（分层约束），故在此独立实现。仅作为默认值使用——WatermelonItemRepository
 * 构造函数可注入替换实现，便于单测固定时区。
 */

/** 设备当前 IANA 时区；取不到时回退 UTC。 */
export function getDeviceTzid(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
