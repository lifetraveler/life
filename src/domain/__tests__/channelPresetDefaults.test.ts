/**
 * resolveChannelPreset 纯函数测试（切片 19 真机验收 4 反馈，用户既定需求）：
 * 渠道预设解析规则 = 默认（isDefault）预设优先 → 无默认取第一条 → 一个都没有 null。
 * 闪电添加落库链（savePlan）与手动表单（ReminderChannelFields 自动填充）共用本规则，
 * 行为必须一致。
 */
import { resolveChannelPreset } from '../channelPreset';
import type { ChannelPreset, ChannelPresetType } from '../channelPreset';

function preset(id: string, type: ChannelPresetType, isDefault: boolean): ChannelPreset {
  return {
    id,
    name: `p-${id}`,
    type,
    configJson: `cfg-${id}`,
    isDefault,
    createdAt: Number(id),
  };
}

describe('resolveChannelPreset（切片 19 验收 4：默认 → 第一条 → null）', () => {
  it('同 type 有默认预设：默认优先于数组第一条', () => {
    const presets = [preset('1', 'webhook', false), preset('2', 'webhook', true)];
    expect(resolveChannelPreset('webhook', presets)?.id).toBe('2');
  });

  it('同 type 无默认：取数组第一条（listChannelPresets 为 created_at 降序 → 最新创建）', () => {
    const presets = [preset('9', 'webhook', false), preset('3', 'webhook', false)];
    expect(resolveChannelPreset('webhook', presets)?.id).toBe('9');
  });

  it('异 type 预设不参与解析（apprise 的默认不影响 webhook）', () => {
    const presets = [preset('5', 'apprise', true)];
    expect(resolveChannelPreset('webhook', presets)).toBeNull();
    expect(resolveChannelPreset('apprise', presets)?.id).toBe('5');
  });

  it('空列表 → null（调用方据此降级：闪电添加披露、表单保持空配置）', () => {
    expect(resolveChannelPreset('webhook', [])).toBeNull();
  });
});
