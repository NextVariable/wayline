import type { City } from "../types/place";

export const cities: City[] = [
  { name: "北京", lat: 39.9042, lng: 116.4074, zoom: 11 },
  { name: "上海", lat: 31.2304, lng: 121.4737, zoom: 11 },
  { name: "广州", lat: 23.1291, lng: 113.2644, zoom: 11 },
  { name: "深圳", lat: 22.5431, lng: 114.0579, zoom: 11 },
];

export const cityCatalog: City[] = [
  ...cities,
  { name: "杭州", lat: 30.2741, lng: 120.1551, zoom: 11 },
  { name: "苏州", lat: 31.2989, lng: 120.5853, zoom: 11 },
  { name: "南京", lat: 32.0603, lng: 118.7969, zoom: 11 },
  { name: "成都", lat: 30.5728, lng: 104.0668, zoom: 11 },
  { name: "武汉", lat: 30.5928, lng: 114.3055, zoom: 11 },
  { name: "西安", lat: 34.3416, lng: 108.9398, zoom: 11 },
  { name: "重庆", lat: 29.563, lng: 106.5516, zoom: 11 },
  { name: "天津", lat: 39.3434, lng: 117.3616, zoom: 11 },
  { name: "沧州", lat: 38.3044, lng: 116.8387, zoom: 11 },
  { name: "黄骅", lat: 38.3714, lng: 117.3301, zoom: 12 },
  { name: "十堰", lat: 32.6294, lng: 110.7989, zoom: 11 },
  { name: "佛山", lat: 23.0218, lng: 113.1219, zoom: 11 },
  { name: "珠海", lat: 22.2716, lng: 113.5767, zoom: 11 },
  { name: "香港", lat: 22.3193, lng: 114.1694, zoom: 11 },
  { name: "宁波", lat: 29.8683, lng: 121.544, zoom: 11 },
  { name: "青岛", lat: 36.0671, lng: 120.3826, zoom: 11 },
  { name: "厦门", lat: 24.4798, lng: 118.0894, zoom: 11 },
  { name: "合肥", lat: 31.8206, lng: 117.2272, zoom: 11 },
  { name: "长沙", lat: 28.2282, lng: 112.9388, zoom: 11 },
  { name: "郑州", lat: 34.7466, lng: 113.6254, zoom: 11 },
  { name: "济南", lat: 36.6512, lng: 117.1201, zoom: 11 },
  { name: "福州", lat: 26.0745, lng: 119.2965, zoom: 11 },
  { name: "无锡", lat: 31.4912, lng: 120.3119, zoom: 11 },
  { name: "沈阳", lat: 41.8057, lng: 123.4315, zoom: 11 },
  { name: "大连", lat: 38.914, lng: 121.6147, zoom: 11 },
  { name: "昆明", lat: 25.0406, lng: 102.7123, zoom: 11 },
  { name: "东莞", lat: 23.0205, lng: 113.7518, zoom: 11 },
  { name: "南昌", lat: 28.682, lng: 115.8579, zoom: 11 },
  { name: "哈尔滨", lat: 45.8038, lng: 126.5349, zoom: 11 },
  { name: "贵阳", lat: 26.647, lng: 106.6302, zoom: 11 },
  { name: "南宁", lat: 22.817, lng: 108.3669, zoom: 11 },
  { name: "太原", lat: 37.8706, lng: 112.5489, zoom: 11 },
  { name: "长春", lat: 43.8171, lng: 125.3235, zoom: 11 },
  { name: "海口", lat: 20.044, lng: 110.1983, zoom: 11 },
  { name: "兰州", lat: 36.0611, lng: 103.8343, zoom: 11 },
  { name: "乌鲁木齐", lat: 43.8256, lng: 87.6168, zoom: 11 },
  { name: "石家庄", lat: 38.0428, lng: 114.5149, zoom: 11 },
  { name: "呼和浩特", lat: 40.8426, lng: 111.7492, zoom: 11 },
  { name: "澳门", lat: 22.1987, lng: 113.5439, zoom: 11 },
  { name: "三亚", lat: 18.2528, lng: 109.512, zoom: 11 },
  { name: "常州", lat: 31.8107, lng: 119.9741, zoom: 11 },
  { name: "西宁", lat: 36.6171, lng: 101.7782, zoom: 11 },
  { name: "银川", lat: 38.4872, lng: 106.2309, zoom: 11 },
  { name: "拉萨", lat: 29.652, lng: 91.1721, zoom: 11 },
];

const shortcutNames = new Set([
  "北京", "上海", "广州", "深圳", "杭州", "苏州", "南京", "成都",
  "武汉", "西安", "重庆", "天津",
]);

export const cityShortcuts = cityCatalog.filter(city => shortcutNames.has(city.name));

export function findCityPreset(name: string, fallback?: City): City {
  return cityCatalog.find((city) => city.name === name) ?? {
    name,
    lat: fallback?.lat ?? 31.2304,
    lng: fallback?.lng ?? 121.4737,
    zoom: fallback?.zoom ?? 11,
  };
}
