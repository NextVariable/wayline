package app.whereto.business.footprints;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 设备重启后，仅当用户此前启用且没有暂停时才恢复采集。
 * 后台位置权限在 Android 上仍需用户在系统中保持"始终允许"，否则服务启动后会记录中断。
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        FootprintState state = new FootprintState(context);
        if (!state.shouldRecord()) return;
        try {
            FootprintService.start(context);
        } catch (RuntimeException e) {
            // 系统可能拒绝开机后从后台启动前台服务；此时在用户下次打开应用时由界面恢复，并显示中断。
            try {
                FootprintDb.get(context).insertEvent(state.owner(), System.currentTimeMillis(),
                        "gap:重启后未能自动恢复", 0);
            } catch (RuntimeException ignored) {
            }
        }
    }
}
