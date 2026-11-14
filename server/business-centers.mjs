// Official sources define the business destinations. AMap resolves the map point.
const suzhou = 'https://www.suzhou.gov.cn/szsrmzf/wtly/202509/0f87837e898d4bd9bdfa119d846667ed.shtml';
const hongqiao = 'https://www.shanghai.gov.cn/nw31406/20261027/972d96a6f7334f27abc76eb1d699abda.html';
const shenzhenVenues = 'https://commerce.sz.gov.cn/gkmlpt/content/12/12467/post_12467111.html';
const beijing = 'https://www.beijing.gov.cn/gongkai/guihua/wngh/sjzdzxgh/201907/t20190701_100097.html';
export const businessDirectory = new Map([
  ['苏州', [
    ['金鸡湖商务区', '苏州工业园区金鸡湖中央商务区', '120100', suzhou],
    ['苏州高铁新城', '高铁新城', '120300', 'https://www.szxc.gov.cn/szxcrmzf/bmdt/202509/0a5a8cbcd3ea49979560208556136d45.shtml', /相城/],
    ['苏州国际博览中心', '苏州国际博览中心', '140200', suzhou],
  ]],
  ['上海', [
    ['北外滩商务区', '北外滩', '190700', 'https://www.shanghai.gov.cn/nw48504/20200825/0001-48504_65260.html'],
    ['陆家嘴金融城', '陆家嘴金融城(陆家嘴街道)', '120201', 'https://www.pudong.gov.cn/zwgk/ghjh_gmjj/2026/71/352863.html'],
    ['虹桥国际中央商务区', '虹桥国际中央商务区', '120100', hongqiao],
    ['国家会展中心（上海）', '国家会展中心(上海)', '140300', hongqiao],
  ]],
  ['深圳', [
    ['福田中心区', '市中心区', '190700', 'https://www.sz.gov.cn/cn/xxgk/zfxxgj/zwdt/content/post_12669143.html', /福田/],
    ['前海深港现代服务业合作区', '前海深港现代服务业合作区', '120100', 'https://qh.sz.gov.cn/gkmlpt/content/11/11063/mpost_11063234.html'],
    ['深圳会展中心', '深圳会展中心', '140300', shenzhenVenues],
    ['深圳国际会展中心', '深圳国际会展中心', '140300', shenzhenVenues],
  ]],
  ['北京', [
    ['北京商务中心区', '北京商务中心区(北京CBD)', '190700', beijing],
    ['金融街', '金融街', '190700', 'https://open.beijing.gov.cn/html/park/financialStreet.html'],
    ['丽泽金融商务区', '北京丽泽金融商务区', '120201', beijing],
  ]],
  ['广州', [
    ['琶洲商务区', '琶洲', '190700', 'https://ghzyj.gz.gov.cn/ywpd/cxgh/cssj/sjhd/content/post_9656663.html'],
    ['珠江新城', '珠江新城', '190700', 'https://sw.gz.gov.cn/xxgk/ghjh/content/post_7823387.html'],
    ['广交会展馆', '广交会展馆', '140300', 'https://ghzyj.gz.gov.cn/sjb/zw/gzdt/content/post_9930148.html'],
  ]],
  ['杭州', [
    ['钱江世纪城', '钱江世纪城', '120203', 'https://www.hzxcw.gov.cn/content_45981.html'],
    ['钱江新城', '钱江新城', '190700', 'https://www.hzxcw.gov.cn/content_46466.html', /上城/],
    ['杭州国际博览中心（一期）', '杭州国际博览中心(一期)', '140200', 'https://www.hiechangzhou.com/index.php/about/index.html'],
  ]],
  ['南京', [
    ['河西中央商务区', '河西CBD', '190700', 'https://newtown.nanjing.gov.cn/xcyx/pzxc/sypt/201703/t20170321_2110482.html'],
    ['新街口', '新街口', '190700', 'https://www.nanjing.gov.cn/zt/ymsn/202406/t20240620_4695134.html'],
    ['南京国际博览中心', '南京国际博览中心', '140300', 'https://shows.nanjingexpo.com.cn/home/index/about'],
  ]],
  ['成都', [
    ['天府总部商务区', '天府总部商务区', '120100', 'https://jhj.sc.gov.cn/scjhj/xmxz/2025/4/22/1fc412c220174e488ab560aff8f74da5/files/bafa690f8cef429ba5e01ba4e7620ada.pdf'],
    ['交子公园金融商务区', '交子公园金融商务区', '120100', 'https://www.cdjrc.com/About.html'],
    ['中国西部国际博览城', '中国西部国际博览城', '140300', 'https://www.gochengdu.cn/en/article/events/4793'],
    ['成都世纪城新国际会展中心', '成都世纪城新国际会展中心', '140300', 'https://capas-chengdu.hk.messefrankfurt.com/chengdu/zh-cn/planning-preparation/exhibition-ground.html'],
  ]],
  ['武汉', [
    ['武汉中央商务区', '武汉cbd王家墩中央商务区', '190700', 'https://www.jianghan.gov.cn/qt/whcbd/czgk/202410/P020241028384020911976.pdf'],
    ['武汉国际博览中心', '武汉国际博览中心', '140200', 'https://sw.wuhan.gov.cn/xwdt/mtbd/202304/t20230421_2189601.shtml'],
  ]],
  ['西安', [
    ['高新区中央创新区', '高新区中央创新区', '120100', 'https://xdz.xa.gov.cn/xwzx/gxyw/6268a8f2f8fd1c0bdc930155.html'],
    ['西安国际会展中心', '西安国际会展中心', '140300', 'https://www.xianicec.com/'],
  ]],
  ['重庆', [
    ['解放碑中央商务区', '解放碑中央商务区', '120201', 'https://www.cq.gov.cn/zt/yhyshj/aljd/202502/t20250226_14346703.html'],
    ['江北嘴中央商务区', '江北嘴中央商务区', '120201', 'https://sww.cq.gov.cn/zwgk_247/zfxxgkml/lzyj/xzgfxwj1/szfwj/202312/t20231217_12713298.html'],
    ['重庆国际博览中心', '重庆国际博览中心', '140200', 'https://www.cq.gov.cn/zwgk/zfxxgkzl/fdzdgknr/zdxm/dtxx/202404/t20240407_13109847.html'],
  ]],
  ['天津', [
    ['于家堡金融区', '于家堡金融区', '120100', 'https://www.tj.gov.cn/zwgk/szfgb/xqk/2012/14/szfwj/202512/t20251229_7209672.html'],
    ['国家会展中心（天津）', '国家会展中心(天津)', '140300', 'https://www.ncectj.com/'],
  ]],
  ['宁波', [
    ['宁波南部商务区', '宁波南部商务区', '120100', 'https://qyfw.nbyz.gov.cn/bdcj/sq8677/index.html'],
    ['东部新城', '东部新城', '120100', 'https://qf.ningbo.gov.cn/qfpt/fwbk/jrfw/rmzx/art/2025/art_c418d8d5e23642bf8ee53e8379b52afb.html'],
    ['宁波国际会议展览中心', '宁波国际会议展览中心', '140300', 'https://www.zjceia.com/index/fhzdw/162.html'],
  ]],
  ['青岛', [
    ['金家岭金融区', '金家岭金融区', '120300', 'https://www.qingdao.gov.cn/ywdt/zwyw/202010/t20201013_344541.shtml'],
    ['青岛国际会展中心（崂山馆）', '青岛国际会展中心(崂山馆)', '140300', 'https://www.qdicec.com.cn/Page/view/id/1.html'],
  ]],
  ['厦门', [
    ['观音山国际商务营运中心', '观音山国际商务营运中心', '120203', 'https://www.investxiamen.org.cn/detail/6815.html'],
    ['厦门国际会议展览中心', '厦门国际会议展览中心', '140300', 'https://www.xicec.com/venueIntroduction/xicec?kb=1'],
  ]],
  ['合肥', [
    ['滨湖金融小镇', '合肥滨湖金融小镇', '120100', 'https://www.xtkg.com/col45/2818.html'],
    ['合肥滨湖国际会展中心', '合肥滨湖国际会展中心', '140300', 'https://www.haee.com.cn/zdxm/20250807/4cec0d76-a247-42c2-8594-8a1542f45569.html'],
  ]],
  ['长沙', [
    ['梅溪湖国际新城', '梅溪湖国际新城', '120000', 'https://zwfw-new.hunan.gov.cn/onething/basic/city/whsw/xl_tzxm.jsp?project_id=04b7ab508a6d4081b6c80784396b4539'],
    ['长沙国际会展中心', '长沙国际会展中心', '140300', 'https://swt.hunan.gov.cn/hnswt/zt/fmzn/zhzg/201610/t20161019_3388617.html'],
    ['长沙国际会议中心', '长沙国际会议中心', '140300', 'https://ftz.hunan.gov.cn/hnzm/csProject/202104/t20210428_16517065.html'],
  ]],
  ['郑州', [
    ['郑东新区中央商务区', '郑州郑东新区CBD', '120100', 'https://www.zhengdong.gov.cn/lyxl.jhtml'],
    ['郑州国际会展中心', '郑州国际会展中心', '140300', 'https://www.zhengzhou.gov.cn/view23/6685798.jhtml'],
  ]],
  ['济南', [
    ['济南中央商务区', '济南中央商务区', '120000', 'https://ftz.jinan.gov.cn/col67672/art/2025/art_67672_10758.html'],
    ['山东国际会展中心', '山东国际会展中心', '140300', 'https://www.sdcec.cn/index.php?a=lists&catid=7&m=content'],
  ]],
  ['福州', [
    ['闽江北岸中央商务区', '闽江北岸中央商务区', '120100', 'https://zx.fuzhou.gov.cn/zz/csfz/tpxw/202508/t20250815_5062234.htm'],
    ['海峡金融商务区', '海峡金融商务区', '160000', 'https://www.fuzhou.gov.cn/zgfzzt/shfgfgg/zxdt/202409/t20240930_4902412.htm'],
    ['福州海峡国际会展中心', '海峡国际会展中心', '140300', 'https://www.fsicec.com/f/6/col-103.html'],
  ]],
  ['无锡', [
    ['太湖新城金融商务街', '太湖新城金融商务街', '120201', 'https://gxj.wuxi.gov.cn/doc/2026/03/31/4752973.shtml'],
    ['无锡太湖国际博览中心', '无锡太湖国际博览中心(和风路)', '140200', 'https://www.wuxiexpo.com.cn/index.php'],
  ]],
  ['沈阳', [
    ['沈阳金融商贸经济技术开发区', '沈阳金融商贸经济技术开发区', '120100', 'https://www.shenyang.gov.cn/zwgk/zcwj/fggz/szfgzzl/202607/t20260717_5058820.html'],
    ['沈阳国际展览中心', '沈阳国际展览中心', '140300', 'https://swj.shenyang.gov.cn/zwgk/fdzdgknr/jyta/szxta/202611/t20261105_5113908.html'],
  ]],
  ['大连', [
    ['大连东港商务区', '大连东港商务区', '120100', 'https://dldgswq.cn/'],
    ['大连世界博览广场', '大连世界博览广场', '140200', 'https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web3773/site/attach/0/27d36103f44f48dfbe0e28d2c9ce78c5.pdf'],
  ]],
  ['昆明', [
    ['华润拓东商务中心', '华润拓东商务中心', '120201', 'https://zfcxjst.yn.gov.cn/ewebeditor/uploadfile/20210312104215911.pdf'],
    ['昆明滇池国际会展中心', '昆明滇池国际会展中心', '140300', 'https://www.hct.cn/view/klmainMb/24/129/view/2024.html'],
  ]],
  ['东莞', [
    ['东莞国际商务区', '东莞南城国际商务区', '120201', 'https://www.dg.gov.cn/zwgk/zfxxgkml/ncjd/ghjh/ndgzjh/content/post_4519895.html'],
    ['广东现代国际展览中心', '广东现代国际展览中心', '140200', 'https://www.dg.gov.cn/houjie/zjhj/tsmz/hzmz/content/post_4386768.html'],
  ]],
  ['佛山', [
    ['广东金融高新区', '广东金融高新区', '120100', 'https://www.cnbayarea.org.cn/service/ygahzfzptsc/fshn/'],
    ['潭洲国际会展中心', '潭洲国际会展中心', '140300', 'https://www.gicec-china.com/aboutus-zhanguan.html'],
  ]],
  ['珠海', [
    ['十字门中央商务区', '珠海十字门中央商务区(银湾路)', '120201', 'https://www.hengqin.gov.cn/ghhjsj/2024/xwtz/gzgg/ghgl/content/post_3795823.html'],
    ['珠海国际会展中心', '珠海国际会展中心', '140300', 'https://www.zhuhaicec.com/list/11.html'],
  ]],
  ['南昌', [
    ['红谷滩金融商务区 · 金融大街', '金融大街', '190301', 'https://www.nc.gov.cn/ncszf/qtygwj/202303/34080874e4964624a43c6fbc28537922.shtml'],
    ['南昌绿地国际博览中心', '南昌绿地国际博览中心', '140300', 'https://www.expo-nc.com/index.php?catid=1'],
  ]],
  ['哈尔滨', [
    ['哈尔滨新区金融中心', '哈尔滨金融中心', '120201', 'https://www.hlj.gov.cn/hlj/c107858/202310/c00_31676756.shtml', /松北/],
    ['哈尔滨国际会展中心', '哈尔滨国际会展中心', '140300', 'https://www.chtf.org.cn/index.htm'],
  ]],
  ['贵阳', [
    ['贵州金融城', '贵州金融城', '120201', 'https://english.guiyang.gov.cn/guanshanhu/2025-09/19/c_1126854.htm'],
    ['贵阳国际会议展览中心', '贵阳国际会议展览中心', '140300', 'https://english.guiyang.gov.cn/guanshanhu/2023exhibitions.html'],
  ]],
  ['南宁', [
    ['五象新区总部基地', '南宁市五象新区总部基地', '120100', 'https://www.gxzx.gov.cn/index.php?a=show&c=index&catid=214&id=56248&m=content', /良庆/],
    ['南宁国际会展中心', '南宁国际会展中心', '140300', 'https://www.nicec.cn/html/yygl/gsjj/'],
  ]],
  ['太原', [
    ['长风文化商务区', '太原长风文化商务区', '120100', 'https://www.dt.gov.cn/dtszf/sxyw/202507/0c932ec440294098a1aea108e852feb3.shtml'],
    ['晋阳湖国际会展中心', '晋阳湖国际会展中心', '140200', 'https://wjw.shanxi.gov.cn/xwzx/szyw/202607/t20260720_10179868.shtml'],
  ]],
  ['长春', [
    ['东北亚国际金融中心', '东北亚国际金融中心', '120201', 'https://jr.jl.gov.cn/jrzx/tpxw/202610/t20261019_3679854.html'],
    ['长春国际会展中心', '长春国际会展中心', '140300', 'https://www.changzhan.net.cn/exhibition-hall/show.html?id=56'],
  ]],
  ['海口', [
    ['大英山新城市中心区', '新城市中心区', '120000', 'https://ggzy.haikou.gov.cn/gonggao/79257'],
    ['海南国际会展中心', '海南国际会议展览中心', '140300', 'https://jdxq.haikou.gov.cn/xinwen/2026/show-10789.html'],
  ]],
  ['兰州', [
    ['兰州中心写字楼', '兰州中心写字楼', '120201', 'https://static.sse.com.cn/bond/bridge2/disclosure/announcement/c/202001/011839_20200107_DZAJ.pdf', /七里河/],
    ['甘肃国际会展中心', '甘肃国际会展中心', '140300', 'https://swt.gansu.gov.cn/swt/c116814/202403/173870907/files/6555a0c804c54291b391e6d22460a98b.pdf'],
  ]],
  ['乌鲁木齐', [
    ['高铁核心区 · 新疆旅游大厦', '新疆旅游大厦', '120201', 'https://www.wlmq.gov.cn/wlmqs/c119052/202409/de9cb490fc9946d1b556201bb44f3ed2.shtml'],
    ['新疆国际会展中心', '新疆国际会展中心', '140300', 'https://www.urumqi.gov.cn/wlmqs/c119432/202402/c5d396dd574c4950aa836941e61ca598/files/20240328124309540.pdf'],
  ]],
  ['石家庄', [
    ['石家庄中央商务区', '石家庄中央商务区', '120201', 'https://www.sjz.gov.cn/yjsgk/atm/7/20230725154322511.pdf'],
    ['石家庄国际会展中心', '石家庄国际会展中心', '140300', 'https://scjg.sjz.gov.cn/columns/9704bc53-9463-4d5b-8900-cbd23118aeca/202407/30/1ffaee3c-0036-4a08-b71d-bbc3cdcb12e1.html'],
  ]],
  ['呼和浩特', [
    ['如意工业园区', '如意工业园区', '120100', 'https://wzs.mofcom.gov.cn/cms_files/oldfile/wzs/202101/20210106142113814.pdf'],
    ['内蒙古国际会展中心', '内蒙古国际会展中心', '140300', 'https://www.hhhtswltjt.com/article/detail-33.html'],
  ]],
  ['三亚', [
    ['三亚中央商务区', '三亚中央商务区', '120201', 'https://syipb.sanya.gov.cn/tzcjjsite/zyswj/202606/d1c901a0937c4be7b7e02f7337877b73.shtml'],
    ['红树林国际会议中心', '红树林国际会议中心', '080000', 'https://syipb.sanya.gov.cn/tzcjjsite/xxjl/202512/d3509f03810b48e5aa94730e13d17922.shtml'],
  ]],
  ['银川', [
    ['阅海湾中央商务区', '银川阅海湾中央商务区', '120100', 'https://www.yinchuan.gov.cn/xxgk/bmxxgkml/szfbgt/xxgkml_1841/yata_1854/202512/t20251208_5103280.html'],
    ['银川国际会展中心', '银川国际会展中心', '140300', 'https://dofcom.nx.gov.cn/jgsz_274/nsjg/zablhmscbgs/csgz_65475/202505/t20250509_4902653.html'],
  ]],
  ['西宁', [
    ['海湖新区', '海湖新区', '120000', 'https://www.csrc.gov.cn/qinghai/c104505/c3874134/3874134/files/%E9%9D%92%E6%B5%B7%E8%BE%96%E5%8C%BA%E8%AF%81%E5%88%B8%E6%9C%9F%E8%B4%A7%E7%BB%8F%E8%90%A5%E6%9C%BA%E6%9E%84%E5%9F%BA%E6%9C%AC%E4%BF%A1%E6%81%AF%E8%A1%A8%EF%BC%8820220621%EF%BC%89.pdf'],
    ['青海国际会展中心', '青海国际会展中心(南京路)', '140300', 'https://dofcom.nx.gov.cn/xwzx_274/tzgg/202606/t20260617_5267891.html'],
  ]],
  ['拉萨', [
    ['拉萨高新区', '拉萨高新区', '120100', 'https://lwxq.lasa.gov.cn/lwxqgwh/xqjj/202411/e7a55c84f3d74bf09113a514a775f080.shtml'],
    ['西藏会展中心 1 号馆', '西藏自治区会展中心1号馆', '140300', 'https://www.al.gov.cn/info/1034/31378.htm'],
  ]],
  ['常州', [
    ['常州金融商务广场', '常州金融商务广场', '120100', 'https://www.changzhou.gov.cn/gi_news/535155927318591'],
    ['常州国际会展中心', '常州国际会展中心', '140300', 'https://www.cznd.gov.cn/html/cznd/2026/EFBJILJD_0930/579087.html'],
  ]],
]);
