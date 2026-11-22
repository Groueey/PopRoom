import { describe, expect, it } from 'vitest';
import { buildMapNavigationOptions } from '@/src/lib/mapNavigation';

describe('mapNavigation URI builder', () => {
  const location = '紫竹院公园东门';
  const encoded = encodeURIComponent(location);

  it('returns empty array for blank or whitespace-only locationName across all platforms', () => {
    expect(buildMapNavigationOptions('', 'ios')).toEqual([]);
    expect(buildMapNavigationOptions('   \t\n  ', 'android')).toEqual([]);
    expect(buildMapNavigationOptions(' ', 'web')).toEqual([]);
  });

  it('builds ios options with iosamap, baidumap, apple maps, and web fallback using encoded Chinese query', () => {
    const options = buildMapNavigationOptions(`  ${location}  `, 'ios');
    const ids = options.map((o) => o.id);

    expect(ids).toEqual(['amap', 'baidu', 'apple', 'web']);

    const amap = options.find((o) => o.id === 'amap');
    const baidu = options.find((o) => o.id === 'baidu');
    const apple = options.find((o) => o.id === 'apple');
    const web = options.find((o) => o.id === 'web');

    expect(amap?.url).toContain('iosamap://');
    expect(amap?.url).toContain(encoded);
    expect(amap?.fallbackUrl).toMatch(/^https:\/\//);
    expect(amap?.fallbackUrl).toContain(encoded);

    expect(baidu?.url).toContain('baidumap://');
    expect(baidu?.url).toContain(encoded);
    expect(baidu?.fallbackUrl).toMatch(/^https:\/\//);
    expect(baidu?.fallbackUrl).toContain(encoded);

    expect(apple?.url).toContain('maps://');
    expect(apple?.url).toContain(encoded);
    expect(apple?.fallbackUrl).toMatch(/^https:\/\//);
    expect(apple?.fallbackUrl).toContain(encoded);

    expect(web?.url).toMatch(/^https:\/\//);
    expect(web?.url).toContain(encoded);
    expect(web?.fallbackUrl).toMatch(/^https:\/\//);
    expect(web?.fallbackUrl).toContain(encoded);
  });

  it('builds android options with androidamap, baidumap, and web fallback, excluding Apple Maps', () => {
    const options = buildMapNavigationOptions(location, 'android');
    const ids = options.map((o) => o.id);

    expect(ids).toEqual(['amap', 'baidu', 'web']);
    expect(options.find((o) => o.id === 'apple')).toBeUndefined();

    const amap = options.find((o) => o.id === 'amap');
    const baidu = options.find((o) => o.id === 'baidu');

    expect(amap?.url).toContain('androidamap://');
    expect(amap?.url).toContain(encoded);
    expect(baidu?.url).toContain('baidumap://');
    expect(baidu?.url).toContain(encoded);
  });

  it('builds web options using https URLs only', () => {
    const options = buildMapNavigationOptions(location, 'web');
    expect(options).toHaveLength(1);
    expect(options[0]?.id).toBe('web');
    expect(options[0]?.url).toMatch(/^https:\/\//);
    expect(options[0]?.url).toContain(encoded);
    expect(options[0]?.fallbackUrl).toMatch(/^https:\/\//);
    expect(options[0]?.fallbackUrl).toContain(encoded);
  });
});
