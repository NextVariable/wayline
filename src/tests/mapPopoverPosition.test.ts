import {expect,it} from "vitest";
import {mapPopoverPosition} from "../lib/mapPopoverPosition";
it("opens beside the triggering control instead of the top of the toolbar",()=>{
 const result=mapPopoverPosition({left:1340,right:1380,top:410,height:40},{width:224,height:260},{width:1440,height:900});
 expect(result).toEqual({left:1104,top:300});expect(result.top).toBeGreaterThan(200);
});
it("keeps the left placement on a narrow mobile viewport",()=>{
 const result=mapPopoverPosition({left:334,right:378,top:230,height:44},{width:224,height:280},{width:390,height:844});
 expect(result).toEqual({left:98,top:112});
});
it("avoids the top and bottom edges in short windows",()=>{
 const top=mapPopoverPosition({left:900,right:940,top:0,height:40},{width:224,height:260},{width:1000,height:320});
 const bottom=mapPopoverPosition({left:900,right:940,top:280,height:40},{width:224,height:260},{width:1000,height:320});
 expect(top.top).toBe(12);expect(bottom.top).toBe(48);expect(bottom.top+260).toBe(308);
});
