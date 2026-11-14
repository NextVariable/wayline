package app.whereto.business.footprints;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TrackingPolicyTest {
    private static final long T0 = 1_700_000_000_000L;
    private static TrackingPolicy.Fix fix(long offsetSec, double lat, double lng, float acc) {
        return new TrackingPolicy.Fix(T0 + offsetSec * 1000, lat, lng, acc);
    }
    private static long now(long offsetSec) { return T0 + offsetSec * 1000 + 1000; }

    @Test public void rejectsLowAccuracyAndInvalid() {
        TrackingPolicy p = new TrackingPolicy(0);
        assertEquals(TrackingPolicy.Verdict.REJECT, p.onFix(fix(0, 31.2, 121.4, 500f), now(0)).verdict);
        assertEquals(TrackingPolicy.Verdict.REJECT, p.onFix(fix(0, 95, 121.4, 10f), now(0)).verdict);
        assertEquals(TrackingPolicy.Verdict.REJECT, p.onFix(fix(0, Double.NaN, 121.4, 10f), now(0)).verdict);
    }

    @Test public void acceptsMovementInSameSegment() {
        TrackingPolicy p = new TrackingPolicy(3);
        assertEquals(3, p.onFix(fix(0, 31.2000, 121.4000, 10f), now(0)).segment);
        TrackingPolicy.Result r = p.onFix(fix(10, 31.2005, 121.4000, 10f), now(10));
        assertEquals(TrackingPolicy.Verdict.ACCEPT, r.verdict);
        assertEquals(3, r.segment);
    }

    @Test public void rejectsTeleportJump() {
        TrackingPolicy p = new TrackingPolicy(0);
        p.onFix(fix(0, 31.2, 121.4, 10f), now(0));
        assertEquals(TrackingPolicy.Verdict.REJECT, p.onFix(fix(5, 31.3, 121.4, 10f), now(5)).verdict);
    }

    @Test public void longGapStartsNewSegmentWithoutBridging() {
        TrackingPolicy p = new TrackingPolicy(0);
        p.onFix(fix(0, 31.2, 121.4, 10f), now(0));
        TrackingPolicy.Result r = p.onFix(fix(300, 31.25, 121.45, 10f), now(300));
        assertEquals(TrackingPolicy.Verdict.ACCEPT, r.verdict);
        assertEquals(1, r.segment);
    }

    @Test public void markBreakForcesNewSegment() {
        TrackingPolicy p = new TrackingPolicy(0);
        p.onFix(fix(0, 31.2, 121.4, 10f), now(0));
        p.markBreak();
        TrackingPolicy.Result r = p.onFix(fix(10, 31.2002, 121.4, 10f), now(10));
        assertEquals(1, r.segment);
    }

    @Test public void skipsJitterAndRejectsOutOfOrder() {
        TrackingPolicy p = new TrackingPolicy(0);
        p.onFix(fix(10, 31.2, 121.4, 10f), now(10));
        assertEquals(TrackingPolicy.Verdict.SKIP, p.onFix(fix(20, 31.200005, 121.4, 10f), now(20)).verdict);
        assertEquals(TrackingPolicy.Verdict.REJECT, p.onFix(fix(5, 31.2, 121.4, 10f), now(20)).verdict);
    }

    @Test public void entersStillAfterFiveMinutesInPlace() {
        TrackingPolicy p = new TrackingPolicy(0);
        boolean still = false;
        for (int t = 0; t <= 360; t += 30) {
            TrackingPolicy.Result r = p.onFix(fix(t, 31.2 + (t % 60 == 0 ? 0.00001 : 0), 121.4, 10f), now(t));
            still = still || r.enterStill;
        }
        assertTrue(still);
    }

    @Test public void movementDoesNotEnterStill() {
        TrackingPolicy p = new TrackingPolicy(0);
        for (int t = 0; t <= 360; t += 30) {
            assertFalse(p.onFix(fix(t, 31.2 + t * 0.00002, 121.4, 10f), now(t)).enterStill);
        }
    }
}
