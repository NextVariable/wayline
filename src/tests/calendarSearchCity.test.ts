import { describe, expect, it } from 'vitest';
import { calendarSearchCity } from '../lib/geoSearch';
import { findCityPreset } from '../data/cities';
const suzhou = findCityPreset('苏州');
describe('calendar address city scope', () => {
  it('searches a named destination instead of the map city', () => {
    expect(calendarSearchCity('上海虹桥站', suzhou).name).toBe('上海');
    expect(calendarSearchCity('中国 上海市闵行区申虹路', suzhou).name).toBe('上海');
  });
  it('keeps local venues and street names in the current scope', () => {
    expect(calendarSearchCity('国际会议中心', suzhou)).toBe(suzhou);
    expect(calendarSearchCity('南京路100号', suzhou)).toBe(suzhou);
    expect(calendarSearchCity('苏州园区上海公司', suzhou)).toBe(suzhou);
  });
});
