/** Keep file/parser and browser internals out of user-facing feedback. */
export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof SyntaxError) return fallback;
  if (error instanceof Error && /^[\u3400-\u9fff]/.test(error.message)) return error.message;
  return fallback;
}
/** Only bounded application feedback crosses from a failed planning request. */
export class PlannerRequestError extends Error {
  constructor(status:number, detail:unknown) {
    const safe=typeof detail==='string'&&detail.length<=100&&/^[\u3400-\u9fff][\u3400-\u9fff\d，。；：、（）\s至-]*$/.test(detail);
    super(status===429?'查询较频繁，请稍后重试':safe?detail.replace(/[。\s]+$/,''):status===404?'规划服务尚未连接，请重新打开页面':'查询服务暂时未响应，请重试');
  }
}
