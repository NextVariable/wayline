import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GoogleCalendarConnection, suggestedCalendar } from '../components/GoogleCalendarConnection';
import type { GoogleCalendarState, GoogleCalendarStatus } from '../lib/useGoogleCalendar';

const primary = { id:'primary', summary:'工作行程', primary:true };
const shared = { id:'shared', summary:'团队共享', primary:false };
const base: GoogleCalendarStatus = { configured:true, connected:true, calendars:[primary,shared], selected:[] };
const show = (status: GoogleCalendarStatus | null, overrides: Partial<GoogleCalendarState> = {}) =>
  renderToStaticMarkup(<GoogleCalendarConnection connection={{ status, error:'', busy:false,
    action:async ()=>{}, refresh:async ()=>{}, ...overrides }} />);

it('offers one-click primary calendar sync and a way to change the selection', () => {
  const markup=show(base);
  expect(markup).toContain('同步「工作行程」');
  expect(markup).toContain('选择其他日历');
  expect(suggestedCalendar({...base,calendars:[shared]})).toBe(shared);
});

it('requires a choice when multiple readable calendars lack a unique primary', () => {
  const status={...base,calendars:[shared,{...shared,id:'second',summary:'另一本'}]};
  expect(suggestedCalendar(status)).toBeUndefined();
  expect(show(status)).toContain('同步所选日历');
  expect(show({...base,calendars:[]})).toContain('没有可读取的日历');
});

it('distinguishes progress, successful empty sync and actionable errors', () => {
  expect(show(base,{busy:true})).toContain('正在首次同步');
  expect(show({...base,selected:['primary'],lastSync:1,events:[]})).toContain('此时间范围内没有日程');
  expect(show(base,{error:'暂不可用'})).toContain('重试同步');
  expect(show(null,{error:'暂不可用'})).toContain('重试连接');
  expect(show({...base,needsReconnect:true})).toContain('重新授权');
});
