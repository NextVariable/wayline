package app.whereto.business.footprints;

import android.content.Context;
import android.content.SharedPreferences;

/** 用户意图与运行状态。"启用"和"暂停"由用户操作写入，系统重启或回收不会改变它们。 */
public final class FootprintState {
    private final SharedPreferences prefs;

    public FootprintState(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences("footprints", Context.MODE_PRIVATE);
    }

    public synchronized String installationId() {
        String id = prefs.getString("installationId", "");
        if (id.isEmpty()) { id = java.util.UUID.randomUUID().toString(); prefs.edit().putString("installationId", id).commit(); }
        return id;
    }

    public boolean enabled() { return prefs.getBoolean("enabled", false); }
    public boolean paused() { return prefs.getBoolean("paused", false); }
    public String owner() { return prefs.getString("owner", ""); }
    public boolean running() { return prefs.getBoolean("running", false); }
    public long lastFixAt() { return prefs.getLong("lastFixAt", 0L); }
    public boolean still() { return prefs.getBoolean("still", false); }

    /** 只有"已启用且未暂停"才允许采集，开机或服务重启都以此为准。 */
    public boolean shouldRecord() { return enabled() && !paused() && !owner().isEmpty(); }

    public void enable(String owner) {
        if (!owner.equals(owner())) prefs.edit().putLong("lastFixAt", 0L).putBoolean("running", false).putBoolean("still", false).apply();
        prefs.edit().putBoolean("enabled", true).putBoolean("paused", false).putString("owner", owner).apply();
    }
    public void disable() {
        prefs.edit().putBoolean("enabled", false).putBoolean("paused", false).putBoolean("running", false).apply();
    }
    public void setPaused(boolean paused) { prefs.edit().putBoolean("paused", paused).apply(); }
    public void setRunning(boolean running) { prefs.edit().putBoolean("running", running).apply(); }
    public void setLastFixAt(long time) { prefs.edit().putLong("lastFixAt", time).apply(); }
    public void setStill(boolean still) { prefs.edit().putBoolean("still", still).apply(); }
}
