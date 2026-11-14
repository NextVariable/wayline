import { expect, it } from "vitest";
import { userFacingError } from "../lib/userFacingError";
it("replaces raw parser and browser internals with actionable import feedback",()=>{
 for(const error of [new SyntaxError("Unexpected token x in JSON"),new Error("Failed to fetch"),null,"internal"])
  expect(userFacingError(error,"请选择有效备份，原记录未改变。")).toBe("请选择有效备份，原记录未改变。");
});
it("keeps specific application validation feedback",()=>{
 expect(userFacingError(new Error("备份超过20MB，请拆分后导入"),"无法导入")).toBe("备份超过20MB，请拆分后导入");
});
import {PlannerRequestError} from '../lib/userFacingError';
// @ts-expect-error server
import {apiError} from '../../server/api-error.mjs';
it('keeps a clear planning failure reason without displaying upstream URLs or keys',()=>{
 expect(new PlannerRequestError(400,'请确认入住人数、间数和床型').message).toBe('请确认入住人数、间数和床型');
 expect(new PlannerRequestError(429,null).message).toContain('频繁');
 for(const detail of ['https://example.com?key=secret','密钥 token=secret','/Users/private/file'])expect(new PlannerRequestError(503,detail).message).toBe('查询服务暂时未响应，请重试');
 expect(apiError(new Error('请确认入住人数、间数和床型')).status).toBe(400);
});
