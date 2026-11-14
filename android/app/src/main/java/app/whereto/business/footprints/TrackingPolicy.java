package app.whereto.business.footprints;

/**
 * 采样过滤与静止判断。纯逻辑，不依赖 Android，可直接在 JVM 上做单元测试。
 * 规则与网页端 acceptPoint 保持一致：不补点、不连线，缺口开新段。
 */
public final class TrackingPolicy {
    public static final float MAX_ACCURACY_M = 100f;
    public static final long BREAK_MS = 120_000L;
    public static final long STILL_AFTER_MS = 5 * 60_000L;
    public static final double STILL_RADIUS_M = 30.0;
    public static final double WAKE_DISTANCE_M = 100.0;

    public static final class Fix {
        public final long time;
        public final double lat;
        public final double lng;
        public final float accuracy;

        public Fix(long time, double lat, double lng, float accuracy) {
            this.time = time;
            this.lat = lat;
            this.lng = lng;
            this.accuracy = accuracy;
        }
    }

    public enum Verdict { ACCEPT, SKIP, REJECT }

    public static final class Result {
        public final Verdict verdict;
        public final int segment;
        public final boolean enterStill;

        Result(Verdict verdict, int segment, boolean enterStill) {
            this.verdict = verdict;
            this.segment = segment;
            this.enterStill = enterStill;
        }
    }

    private Fix last;
    private Fix anchor;
    private int segment;
    private boolean breakPending;

    public TrackingPolicy(int firstSegment) {
        this.segment = firstSegment;
    }

    /** 暂停、恢复、权限变化、系统回收等任何连续性中断后调用，下一个有效点会开新段。 */
    public void markBreak() {
        breakPending = true;
        anchor = null;
    }

    public Result onFix(Fix fix, long now) {
        if (!Double.isFinite(fix.lat) || !Double.isFinite(fix.lng)
                || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180
                || !(fix.accuracy >= 0) || fix.accuracy > MAX_ACCURACY_M
                || fix.time <= 0 || fix.time > now + 10_000L) {
            return new Result(Verdict.REJECT, segment, false);
        }
        int nextSegment = segment;
        if (last != null) {
            if (fix.time <= last.time) return new Result(Verdict.REJECT, segment, false);
            double dt = (fix.time - last.time) / 1000.0;
            double dist = distance(last.lat, last.lng, fix.lat, fix.lng);
            if (!breakPending && dt < BREAK_MS / 1000.0
                    && dist > Math.max(300.0, dt * 120.0 + fix.accuracy + last.accuracy)) {
                return new Result(Verdict.REJECT, segment, false);
            }
            if (dt >= BREAK_MS / 1000.0) nextSegment++;
        }
        if (breakPending) nextSegment = Math.max(nextSegment, segment + 1);

        boolean enterStill = false;
        if (anchor == null || distance(anchor.lat, anchor.lng, fix.lat, fix.lng)
                > Math.max(STILL_RADIUS_M, fix.accuracy)) {
            anchor = fix;
        } else if (fix.time - anchor.time >= STILL_AFTER_MS) {
            enterStill = true;
        }

        if (last != null && nextSegment == segment
                && distance(last.lat, last.lng, fix.lat, fix.lng)
                < Math.max(5.0, Math.min(fix.accuracy, last.accuracy) / 2.0)) {
            return new Result(Verdict.SKIP, segment, enterStill);
        }
        segment = nextSegment;
        breakPending = false;
        last = fix;
        return new Result(Verdict.ACCEPT, segment, enterStill);
    }

    public static double distance(double lat1, double lng1, double lat2, double lng2) {
        double rad = Math.PI / 180.0;
        double dLat = Math.sin((lat2 - lat1) * rad / 2);
        double dLng = Math.sin((lng2 - lng1) * rad / 2);
        double a = dLat * dLat + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * dLng * dLng;
        return 6371008.8 * 2 * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }
}
