import {
  buildCreateReminderInput,
  validateReminderForm,
} from '../reminderForm';
import type { ReminderFormValues } from '../reminderForm';

function validValues(overrides: Partial<ReminderFormValues> = {}): ReminderFormValues {
  return {
    frequency: 'daily',
    localTimeHour: 9,
    localTimeMinute: 30,
    weekdays: [],
    dayOfMonth: null,
    tzid: 'Asia/Shanghai',
    startAt: 1749427200000,
    enabled: true,
    ...overrides,
  };
}

describe('validateReminderForm（切片 6 表单纯校验）', () => {
  it('合法 daily 表单返回空错误对象', () => {
    expect(validateReminderForm(validValues())).toEqual({});
  });

  it('时间越界/未填报 localTime 错误', () => {
    expect(validateReminderForm(validValues({ localTimeHour: 24 })).localTime).toBeDefined();
    expect(validateReminderForm(validValues({ localTimeMinute: 60 })).localTime).toBeDefined();
    expect(validateReminderForm(validValues({ localTimeHour: null })).localTime).toBeDefined();
    expect(validateReminderForm(validValues({ localTimeMinute: null })).localTime).toBeDefined();
  });

  it('weekly：未选星期 / 星期越界报 weekdays 错误', () => {
    expect(validateReminderForm(validValues({ frequency: 'weekly' })).weekdays).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'weekly', weekdays: [0, 8] })).weekdays,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'weekly', weekdays: [1, 7] })).weekdays,
    ).toBeUndefined();
  });

  it('monthly：dayOfMonth 越界/未填报 dayOfMonth 错误', () => {
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: null })).dayOfMonth)
      .toBeDefined();
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: 0 })).dayOfMonth)
      .toBeDefined();
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: 32 })).dayOfMonth)
      .toBeDefined();
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: 31 })).dayOfMonth)
      .toBeUndefined();
  });

  it('白名单外 tzid 报 tzid 错误', () => {
    expect(validateReminderForm(validValues({ tzid: 'Europe/London' })).tzid).toBeDefined();
    expect(validateReminderForm(validValues({ tzid: 'America/New_York' })).tzid).toBeUndefined();
  });

  it('startAt 非法报 startAt 错误', () => {
    expect(validateReminderForm(validValues({ startAt: null })).startAt).toBeDefined();
    expect(validateReminderForm(validValues({ startAt: Number.NaN })).startAt).toBeDefined();
  });
});

describe('buildCreateReminderInput', () => {
  it('weekly 透传 weekdays；monthly 归零 weekdays、透传 dayOfMonth', () => {
    const weekly = buildCreateReminderInput(
      validValues({ frequency: 'weekly', weekdays: [1, 3] }),
      'item-1',
    );
    expect(weekly.weekdays).toEqual([1, 3]);
    expect(weekly.dayOfMonth).toBe(0);

    const monthly = buildCreateReminderInput(
      validValues({ frequency: 'monthly', dayOfMonth: 15 }),
      'item-1',
    );
    expect(monthly.weekdays).toEqual([]);
    expect(monthly.dayOfMonth).toBe(15);
  });

  it('itemId / enabled / startAt / tzid 原样透传', () => {
    const input = buildCreateReminderInput(validValues({ enabled: false }), 'item-9');
    expect(input.itemId).toBe('item-9');
    expect(input.enabled).toBe(false);
    expect(input.startAt).toBe(1749427200000);
    expect(input.tzid).toBe('Asia/Shanghai');
    expect(input.localTimeHour).toBe(9);
    expect(input.localTimeMinute).toBe(30);
  });
});
