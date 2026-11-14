/** Verified place candidates used when live search is unavailable. Kept apart from request routing. */
export const KNOWN_PLACES = [
  { test: /港中深|香港中文大学深圳|香港中文大学（深圳）/, place: { name: "香港中文大学（深圳）", city: "深圳", category: "university", lat: 22.6861, lng: 114.2099, address: "广东省深圳市龙岗区龙翔大道2001号", reason: "深圳校区，位置已确认。" } },
  { test: /大疆|dji/, place: { name: "大疆天空之城", city: "深圳", category: "business", lat: 22.5848, lng: 113.9548, address: "广东省深圳市南山区西丽街道仙元路55号", reason: "大疆深圳总部所在地。" } },
  { test: /深圳技术大学/, place: { name: "深圳技术大学", city: "深圳", category: "university", lat: 22.7221, lng: 114.3833, address: "广东省深圳市坪山区兰田路3002号", reason: "深圳东部高校，位置已确认。" } },
  { test: /南方科技大学|南科大/, place: { name: "南方科技大学", city: "深圳", category: "university", lat: 22.6, lng: 113.99, address: "广东省深圳市南山区学苑大道1088号", reason: "深圳高校，位置已确认。" } },
  { test: /平潭/, not: /平湖|深圳/, place: { name: "平潭", city: "福州", category: "attraction", lat: 25.4987, lng: 119.7911, address: "福建省福州市平潭县", reason: "福建平潭，位置已确认。" } },
  { test: /武夷山/, place: { name: "武夷山", city: "南平", category: "attraction", lat: 27.7566, lng: 117.9867, address: "福建省南平市武夷山市", reason: "武夷山景区所在城市，位置已确认。" } },
  { test: /青海湖/, place: { name: "青海湖", city: "海南藏族自治州", category: "attraction", lat: 36.7594, lng: 100.7478, address: "青海省海南藏族自治州共和县", reason: "青海湖核心湖区，位置已确认。" } },
  { test: /崇武/, place: { name: "崇武古城", city: "泉州", category: "attraction", lat: 24.8819, lng: 118.9231, address: "福建省泉州市惠安县崇武镇", reason: "崇武古城所在区域，位置已确认。" } },
  { test: /无锡/, place: { name: "无锡", city: "无锡", category: "custom", lat: 31.4912, lng: 120.3119, address: "江苏省无锡市", reason: "城市位置已确认。" } },
  { test: /泉州/, place: { name: "泉州", city: "泉州", category: "custom", lat: 24.874, lng: 118.677, address: "福建省泉州市", reason: "城市位置已确认。" } },
];

export function knownResolveCandidates(keyword) {
  const normalized = keyword.toLowerCase().replace(/[（）()·\s]/g, "");
  return KNOWN_PLACES
    .filter(({ test, not }) => test.test(normalized) && (!not || !not.test(normalized)))
    .map(({ place }) => ({ source: "imported", isMatched: true, ...place }));
}
