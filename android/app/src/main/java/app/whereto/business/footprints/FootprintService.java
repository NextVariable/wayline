package app.whereto.business.footprints;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * 前台定位服务：采样直接写入本机数据库，不依赖 WebView 是否存活。
 * 使用系统 LocationManager，不依赖 Google Play 服务。
 */
public class FootprintService extends Service implements LocationListener {
    static final String CHANNEL = "footprints";
    static final int NOTIFICATION_ID = 4101;
    private static final long MOVING_INTERVAL_MS = 5_000L;
    private static final long STILL_INTERVAL_MS = 60_000L;

    private LocationManager manager;
    private FootprintState state;
    private FootprintDb db;
    private TrackingPolicy policy;
    private String owner = "";
    private boolean listening;
    private boolean still;

    public static void start(Context context) {
        ContextCompat.startForegroundService(context, new Intent(context, FootprintService.class));
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, FootprintService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        state = new FootprintState(this);
        db = FootprintDb.get(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 用户未启用或已暂停时，即使被系统拉起也不得采集。
        if (!state.shouldRecord()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!hasPermission()) {
            interrupt("定位权限已被收回");
            stopSelf();
            return START_NOT_STICKY;
        }
        try { enterForeground(); } catch (RuntimeException e) {
            interrupt("系统不允许后台启动定位，请打开应用恢复");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!owner.equals(state.owner())) policy = null;
        owner = state.owner();
        if (policy == null) {
            policy = new TrackingPolicy(db.maxSegment(owner) + 1);
            // 服务被系统回收或设备重启后重新进入，这里是一个缺口，不补线。
            record(System.currentTimeMillis(), "resume", 0);
        }
        listen(MOVING_INTERVAL_MS);
        state.setRunning(listening);
        return START_STICKY;
    }

    private boolean hasPermission() {
        boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }

    private void enterForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "足迹记录", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, app.whereto.business.MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("正在记录足迹")
                .setContentText("仅保存在本机，可在应用中暂停")
                .setOngoing(true)
                .setContentIntent(pending)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
    }

    private void listen(long interval) {
        try {
            manager.removeUpdates(this);
            boolean any = false;
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, this, Looper.getMainLooper());
                any = true;
            }
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, interval, 0f, this, Looper.getMainLooper());
                any = true;
            }
            listening = any;
            if (!any) interrupt("系统定位已关闭");
        } catch (SecurityException e) {
            listening = false;
            interrupt("定位权限已被收回");
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (policy == null || !state.shouldRecord()) return;
        TrackingPolicy.Result result = policy.onFix(new TrackingPolicy.Fix(
                location.getTime(), location.getLatitude(), location.getLongitude(),
                location.hasAccuracy() ? location.getAccuracy() : Float.MAX_VALUE), System.currentTimeMillis());
        if (result.verdict == TrackingPolicy.Verdict.ACCEPT) {
            try {
                db.insertFix(owner, location.getTime(), location.getLatitude(), location.getLongitude(),
                        location.getAccuracy(), result.segment);
                state.setLastFixAt(location.getTime());
            } catch (RuntimeException e) {
                interrupt("本机保存失败");
                stopSelf();
                return;
            }
        }
        // 静止时降低采样频率；明显移动后恢复。
        if (result.enterStill && !still) {
            still = true;
            state.setStill(true);
            listen(STILL_INTERVAL_MS);
        } else if (!result.enterStill && still && result.verdict == TrackingPolicy.Verdict.ACCEPT) {
            still = false;
            state.setStill(false);
            listen(MOVING_INTERVAL_MS);
        }
    }

    @Override
    public void onProviderDisabled(String provider) {
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                && !manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            interrupt("系统定位已关闭");
            if (policy != null) policy.markBreak();
        }
    }

    @Override
    public void onProviderEnabled(String provider) {
        if (policy != null) {
            policy.markBreak();
            listen(still ? STILL_INTERVAL_MS : MOVING_INTERVAL_MS);
            state.setRunning(listening);
        }
    }

    private void interrupt(String reason) {
        try {
            db.insertEvent(state.owner(), System.currentTimeMillis(), "gap:" + reason, 0);
        } catch (RuntimeException ignored) {
            // 数据库不可用时无法记录缺口，状态里的 running 仍会被清除，界面会显示为已中断。
        }
        state.setRunning(false);
    }

    private void record(long time, String kind, int seg) {
        try {
            db.insertEvent(owner, time, kind, seg);
        } catch (RuntimeException ignored) {
        }
    }

    @Override
    public void onDestroy() {
        try {
            manager.removeUpdates(this);
        } catch (SecurityException ignored) {
        }
        if (state.shouldRecord() && listening) {
            // 非用户操作导致的销毁（系统回收）：留下缺口，下次拉起会开新段。
            record(System.currentTimeMillis(), "gap:服务被系统停止", 0);
        }
        state.setRunning(false);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
