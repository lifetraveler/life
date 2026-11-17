/**
 * 切片 27 阶段 1（AGENTS.md §7.39 D5）：expoSystemCalendarReader.getCalendars
 * 的 color / sourceName 映射测试。
 *
 * expo-calendar 原生模块在 Jest 不可用（切片 9 先例），此处以 jest.mock 注入
 * getCalendarsAsync 夹具，断言领域 SystemCalendarInfo 的防御归一：
 * - color：Android CALENDAR_COLOR 经原生序列化为 '#RRGGBB'（如 superproductive
 *   纯黑 '#000000' 必须原样保留——空串才归 null）；
 * - sourceName：Calendar.source.name（Android ACCOUNT_NAME，筛选面板分组键），
 *   source 缺失/空串 → null；
 * - title 非串 → 空串（切片 9 先例）。
 * 注：TS 类型声明 color / source.name 非可选 string，但 Android 原生 Bundle 可能
 * 带 null，运行时以 typeof 防御（adapter 内先例），夹具以 as unknown as 绕过类型层。
 */
import * as Calendar from 'expo-calendar';

import { expoSystemCalendarReader } from '../systemCalendarAdapters';

jest.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'EVENT' },
  getCalendarsAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async () => 'stub-digest'),
}));

/** jest.mock 工厂替换运行时模块后，经命名空间取回 jest.fn 以注入夹具。 */
const mockExpoCalendar = Calendar as unknown as {
  EntityTypes: { EVENT: string };
  getCalendarsAsync: jest.Mock;
};

afterEach(() => {
  mockExpoCalendar.getCalendarsAsync.mockReset();
});

describe('expoSystemCalendarReader.getCalendars 映射（切片 27 D5）', () => {
  it('全字段透传：id/title/color/source.name 原样映射', async () => {
    mockExpoCalendar.getCalendarsAsync.mockResolvedValueOnce([
      {
        id: '1',
        title: 'mycalendar',
        color: '#E67C73',
        source: { name: 'com.android.calendar - baikal', type: 'at.bitfire.davdroid', isLocalAccount: false },
      },
      {
        id: '2',
        title: 'superproductive',
        color: '#000000',
        source: { name: 'com.android.calendar - baikal', type: 'at.bitfire.davdroid', isLocalAccount: false },
      },
      {
        id: '4',
        title: '生日',
        color: '#F6BF26',
        source: { name: 'Toki', type: 'com.tencent.mobileqq', isLocalAccount: false },
      },
    ] as unknown as Calendar.Calendar[]);

    const result = await expoSystemCalendarReader.getCalendars();
    // 纯黑 '#000000' 是真实日历颜色（superproductive），必须保留、不得归 null。
    expect(result).toEqual([
      { id: '1', title: 'mycalendar', color: '#E67C73', sourceName: 'com.android.calendar - baikal' },
      { id: '2', title: 'superproductive', color: '#000000', sourceName: 'com.android.calendar - baikal' },
      { id: '4', title: '生日', color: '#F6BF26', sourceName: 'Toki' },
    ]);
    // 查询始终按 EVENT 实体（切片 9 语义不变）
    expect(mockExpoCalendar.getCalendarsAsync).toHaveBeenCalledWith(
      mockExpoCalendar.EntityTypes.EVENT,
    );
  });

  it('本地日历（isLocalAccount）同样取 source.name 作 sourceName', async () => {
    mockExpoCalendar.getCalendarsAsync.mockResolvedValueOnce([
      {
        id: '3',
        title: 'Fall Holiday',
        color: '#4986E7',
        source: { name: '本地日历', type: 'LOCAL', isLocalAccount: true },
      },
    ] as unknown as Calendar.Calendar[]);

    const result = await expoSystemCalendarReader.getCalendars();
    expect(result).toEqual([
      { id: '3', title: 'Fall Holiday', color: '#4986E7', sourceName: '本地日历' },
    ]);
  });

  it('color 缺失 / 空串 / 非串 → null（UI 回退默认色）', async () => {
    mockExpoCalendar.getCalendarsAsync.mockResolvedValueOnce([
      { id: 'a', title: 'no-color', source: { name: 'x', type: 'LOCAL', isLocalAccount: true } },
      { id: 'b', title: 'empty-color', color: '', source: { name: 'x', type: 'LOCAL', isLocalAccount: true } },
      { id: 'c', title: 'bad-color', color: 16711680, source: { name: 'x', type: 'LOCAL', isLocalAccount: true } },
    ] as unknown as Calendar.Calendar[]);

    const result = await expoSystemCalendarReader.getCalendars();
    expect(result).toEqual([
      { id: 'a', title: 'no-color', color: null, sourceName: 'x' },
      { id: 'b', title: 'empty-color', color: null, sourceName: 'x' },
      { id: 'c', title: 'bad-color', color: null, sourceName: 'x' },
    ]);
  });

  it('source 缺失 / source.name 缺失 / 空串 → sourceName null（UI 归「其他」组）', async () => {
    mockExpoCalendar.getCalendarsAsync.mockResolvedValueOnce([
      { id: 'd', title: 'no-source', color: '#16A765' },
      { id: 'e', title: 'no-source-name', color: '#16A765', source: { type: 'LOCAL' } },
      { id: 'f', title: 'empty-source-name', color: '#16A765', source: { name: '', type: 'LOCAL' } },
    ] as unknown as Calendar.Calendar[]);

    const result = await expoSystemCalendarReader.getCalendars();
    expect(result).toEqual([
      { id: 'd', title: 'no-source', color: '#16A765', sourceName: null },
      { id: 'e', title: 'no-source-name', color: '#16A765', sourceName: null },
      { id: 'f', title: 'empty-source-name', color: '#16A765', sourceName: null },
    ]);
  });

  it('title 非串 → 空串（切片 9 先例：如实透传，不虚构）', async () => {
    mockExpoCalendar.getCalendarsAsync.mockResolvedValueOnce([
      { id: 'g', title: null, color: '#AB47BC', source: { name: 'x', type: 'LOCAL', isLocalAccount: true } },
    ] as unknown as Calendar.Calendar[]);

    const result = await expoSystemCalendarReader.getCalendars();
    expect(result).toEqual([{ id: 'g', title: '', color: '#AB47BC', sourceName: 'x' }]);
  });
});
