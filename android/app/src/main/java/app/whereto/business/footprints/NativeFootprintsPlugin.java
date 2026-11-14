package app.whereto.business.footprints;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

@CapacitorPlugin(
    name = "NativeFootprints",
    permissions = {
        @Permission(alias = "foreground", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class NativeFootprintsPlugin extends Plugin {

    private FootprintState state() { return new FootprintState(getContext()); }

    private boolean has(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean foregroundGranted() {
        return has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private boolean backgroundGranted() {
        return Build.VERSION.SDK_INT < 29 || has(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private JSObject snapshot() { return snapshot(state().owner()); }

    private JSObject snapshot(String owner) {
        FootprintState s = state();
        JSObject o = new JSObject();
        boolean own = owner.equals(s.owner());
        o.put("owner", owner);
        o.put("installationId", s.installationId());
        o.put("occupied", s.enabled() && !own);
        o.put("platform", "android");
        o.put("enabled", (own && s.enabled()));
        o.put("paused", (own && s.paused()));
        o.put("running", (own && s.running()));
        o.put("still", (own && s.still()));
        o.put("lastFixAt", own ? s.lastFixAt() : 0L);
        o.put("foregroundPermission", foregroundGranted());
        o.put("alwaysPermission", foregroundGranted() && backgroundGranted());
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        String owner = call.getString("owner", "");
        if (owner.isEmpty()) { call.reject("缺少空间标识"); return; }
        call.resolve(snapshot(owner));
    }

    private boolean ownAction(PluginCall call) {
        String owner = call.getString("owner", "");
        if (owner.isEmpty() || !owner.equals(state().owner())) { call.reject("空间不匹配", "owner_conflict"); return false; }
        return true;
    }

    private boolean canEnable(PluginCall call) {
        String owner = call.getString("owner", "");
        if (state().enabled() && !owner.equals(state().owner())) { call.reject("另一空间正在记录", "owner_conflict"); return false; }
        return true;
    }

    /**
     * 用户在足迹页明确点击启用才会走到这里。
     * Android 要求先授予前台定位，再单独申请"始终允许"，分两步请求。
     */
    @PluginMethod
    public void enable(PluginCall call) {
        String owner = call.getString("owner", "");
        if (owner == null || owner.isEmpty()) { call.reject("缺少空间标识"); return; }
        if (!canEnable(call)) return;
        call.getData().put("owner", owner);
        if (!foregroundGranted()) {
            requestPermissionForAlias("foreground", call, "afterForeground");
            return;
        }
        afterForeground(call);
    }

    @PermissionCallback
    private void afterForeground(PluginCall call) {
        if (!foregroundGranted()) { call.reject("未授予定位权限", "denied"); return; }
        if (!backgroundGranted()) {
            // 11 及以上不允许在同一弹窗里直接申请，系统会引导到设置页选择"始终允许"。
            requestPermissionForAlias("background", call, "afterBackground");
            return;
        }
        afterBackground(call);
    }

    @PermissionCallback
    private void afterBackground(PluginCall call) {
        if (!foregroundGranted()) { call.reject("未授予定位权限", "denied"); return; }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        afterNotifications(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        if (!canEnable(call)) return;
        if (!foregroundGranted()) { call.reject("未授予定位权限", "denied"); return; }
        // 即使"始终允许"未授予，也只启动前台服务，并如实返回 alwaysPermission=false，由界面提示。
        state().enable(call.getString("owner"));
        try {
            FootprintService.start(getContext());
        } catch (RuntimeException e) {
            state().disable();
            call.reject("无法启动定位服务");
            return;
        }
        call.resolve(snapshot());
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!ownAction(call)) return;
        FootprintState s = state();
        if (!s.enabled()) { call.resolve(snapshot()); return; }
        s.setPaused(true); // 先写意图，再停服务，避免被误记为系统回收。
        try {
            FootprintDb.get(getContext()).insertEvent(s.owner(), System.currentTimeMillis(), "gap:用户暂停", 0);
        } catch (RuntimeException ignored) {
        }
        FootprintService.stop(getContext());
        s.setRunning(false);
        call.resolve(snapshot());
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (!ownAction(call)) return;
        FootprintState s = state();
        if (!s.enabled()) { call.reject("尚未启用自动足迹"); return; }
        if (!foregroundGranted()) { call.reject("未授予定位权限", "denied"); return; }
        s.setPaused(false);
        try {
            FootprintService.start(getContext());
        } catch (RuntimeException e) {
            s.setPaused(true);
            call.reject("无法启动定位服务");
            return;
        }
        call.resolve(snapshot());
    }

    @PluginMethod
    public void disable(PluginCall call) {
        if (!ownAction(call)) return;
        FootprintState s = state();
        s.disable();
        FootprintService.stop(getContext());
        call.resolve(snapshot());
    }

    /** 引导用户到系统设置，选择"始终允许"。 */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void read(PluginCall call) {
        String owner = call.getString("owner", "");
        if (owner.isEmpty()) { call.reject("缺少空间标识"); return; }
        long after = call.getLong("afterId", 0L);
        int limit = Math.min(call.getInt("limit", 2000), 5000);
        try {
            JSObject out = new JSObject();
            out.put("entries", FootprintDb.get(getContext()).read(owner, after, limit));
            call.resolve(out);
        } catch (JSONException | RuntimeException e) {
            call.reject("读取本机足迹失败");
        }
    }
}
