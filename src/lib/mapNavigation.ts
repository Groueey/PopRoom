/** Supported external map provider identifiers. */
export type MapProviderId = 'amap' | 'baidu' | 'apple' | 'web';

/** Platform-specific deep link option with an HTTPS web fallback URL. */
export interface MapNavigationOption {
  id: MapProviderId;
  label: string;
  url: string;
  fallbackUrl: string;
}

/** Supported client platforms for map URI scheme selection. */
export type MapPlatform = 'ios' | 'android' | 'web';

/**
 * Builds keyword-search map navigation options for the given location name and platform.
 * Returns an empty array when `locationName` is blank or whitespace-only.
 */
export function buildMapNavigationOptions(
  locationName: string,
  platform: MapPlatform,
): MapNavigationOption[] {
  const trimmed = locationName.trim();
  if (!trimmed) {
    return [];
  }

  const encoded = encodeURIComponent(trimmed);
  const amapWebUrl = `https://uri.amap.com/search?keyword=${encoded}&src=poproom`;
  const baiduWebUrl = `https://map.baidu.com/?newmap=1&ie=utf-8&s=${encodeURIComponent(`s&wd=${trimmed}`)}`;
  const osmWebUrl = `https://www.openstreetmap.org/search?query=${encoded}`;

  if (platform === 'web') {
    return [
      {
        id: 'web',
        label: '高德网页版',
        url: amapWebUrl,
        fallbackUrl: osmWebUrl,
      },
    ];
  }

  const amapUrl =
    platform === 'ios'
      ? `iosamap://poi?sourceApplication=poproom&name=${encoded}`
      : `androidamap://poi?sourceApplication=poproom&keywords=${encoded}`;

  const options: MapNavigationOption[] = [
    {
      id: 'amap',
      label: '高德地图',
      url: amapUrl,
      fallbackUrl: amapWebUrl,
    },
    {
      id: 'baidu',
      label: '百度地图',
      url: `baidumap://map/place/search?query=${encoded}&src=poproom`,
      fallbackUrl: baiduWebUrl,
    },
  ];

  if (platform === 'ios') {
    options.push({
      id: 'apple',
      label: 'Apple 地图',
      url: `maps://?q=${encoded}`,
      fallbackUrl: `https://maps.apple.com/?q=${encoded}`,
    });
  }

  options.push({
    id: 'web',
    label: '浏览器地图',
    url: amapWebUrl,
    fallbackUrl: osmWebUrl,
  });

  return options;
}
