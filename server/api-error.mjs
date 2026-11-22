export function apiError(error) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Request body too large') return { status:413, error:'请求内容过大' };
  const invalid = /^(出差查询条件无效|出行条件无效|请选择1至12个有效地点|行程天数应为1至7天|出发日期无效|当前行程计算仅支持北京时间|出行条件过长|活动安排格式无效|出行说明无效|请填写具体出发地点和最早出发时间|请确认入住人数、间数和床型|住宿偏好无效|定位坐标无效|请选择2至12个地点|keyword is required|Invalid JSON)/.test(message);
  if (invalid) return { status:400, error:message === 'Invalid JSON' ? '请求内容无法读取' : (message.match(invalid)?.[1] ?? '请求无效') };
  const operatorMessages = new Set(['真实路线服务未配置','公交查询需要两个地点和明确的出发时间',
    '地图路线查询失败，请重试','地图未返回有效路线','地点查询暂不可用','城市识别暂时不可用']);
  return { status:503, error:operatorMessages.has(message) ? message : '查询暂时无法完成，请稍后重试' };
}
