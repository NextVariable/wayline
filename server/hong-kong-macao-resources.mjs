// Coordinates are WGS84 reference points from Wikidata (CC0) or official links.
const hkBorder = 'https://www.immd.gov.hk/hks/contactus/control_points.html';
const moBorder = 'https://www.customs.gov.mo/gb/notice_passengers_item4.html';
export const hongKongMacaoResources = new Map([
  ['香港', [
    ['business', '中环商务区', 22.281944, 114.158056, '中西区中环', 'Q14767', 'https://www.hkengage.gov.hk/zh-CN/essentials/career-business/ideal-business-locations-for-hong-kong-startups'],
    ['business', '九龙东 · 观塘', 22.313056, 114.225556, '九龙东观塘', 'Q1045119', 'https://www.ekeo.gov.hk/sc/hong-kong-cbd2-kowloon-east-home/strategic-location/index.html'],
    ['business', '香港会议展览中心', 22.283661, 114.172847, '湾仔博览道一号', 'Q597725', 'https://www.hkcec.com/cn/%E4%BA%A4%E9%80%9A%E8%B5%84%E8%AE%AF'],
    ['transport', '香港西九龙站', 22.3036, 114.165, '西九龙', 'Q2130136', hkBorder],
    ['transport', '香港国际机场', 22.314989, 113.934424, '赤鱲角一号客运大楼', 'Q15903839', 'https://www.hongkongairport.com/tc/contact-us/useful-contacts.page'],
    ['transport', '港珠澳大桥香港口岸', 22.318083, 113.951111, '大屿山港珠澳大桥香港口岸', 'Q57599408', hkBorder],
    ['transport', '港澳客轮码头', 22.289372, 114.152153, '上环信德中心', 'Q3207485', 'https://www.mardep.gov.hk/sc/public-services/port-services/terminal/index.html'],
  ]],
  ['澳门', [
    ['business', '南湾商务区 · 中国银行大厦', 22.189889, 113.543, '苏亚利斯博士大马路', 'Q4856086', 'https://www.gov.mo/zh-hant/content/33473-2/'],
    ['business', '澳门旅游塔会展娱乐中心', 22.179722, 113.536667, '南湾新填海区', 'Q1568304', 'https://www.macautower.com.mo/zh-hans/'],
    ['transport', '澳门国际机场', 22.1578359, 113.5764123, '氹仔伟龙马路客运大楼', 'Q525486',
      'https://www.macau-airport.com/cn/contact-us', 'https://goo.gl/maps/cGbQeej1FUD99cwY6'],
    ['transport', '澳门关闸口岸', 22.2147, 113.5488, '关闸边检大楼', 'Q7234412', moBorder],
    ['transport', '外港客运码头', 22.197075, 113.558911, '澳门海港前地', 'Q842280', moBorder],
    ['transport', '氹仔客运码头', 22.1639, 113.576, '氹仔北安', 'Q9289281', moBorder],
  ]],
]);
