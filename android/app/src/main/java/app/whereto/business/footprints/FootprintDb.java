package app.whereto.business.footprints;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONException;

/** 设备本地足迹库。采集服务直接写入，不经过 WebView。 */
public final class FootprintDb extends SQLiteOpenHelper {
    private static FootprintDb instance;

    public static synchronized FootprintDb get(Context context) {
        if (instance == null) instance = new FootprintDb(context.getApplicationContext());
        return instance;
    }

    private FootprintDb(Context context) {
        super(context, "footprints.db", null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,"
                + " time INTEGER NOT NULL, kind TEXT NOT NULL, lat REAL, lng REAL, acc REAL, seg INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX entries_owner_id ON entries(owner, id)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    public synchronized void insertFix(String owner, long time, double lat, double lng, float acc, int seg) {
        ContentValues v = new ContentValues();
        v.put("owner", owner);
        v.put("time", time);
        v.put("kind", "fix");
        v.put("lat", lat);
        v.put("lng", lng);
        v.put("acc", acc);
        v.put("seg", seg);
        getWritableDatabase().insertOrThrow("entries", null, v);
    }

    public synchronized void insertEvent(String owner, long time, String kind, int seg) {
        ContentValues v = new ContentValues();
        v.put("owner", owner);
        v.put("time", time);
        v.put("kind", kind);
        v.put("seg", seg);
        getWritableDatabase().insertOrThrow("entries", null, v);
    }

    public synchronized int maxSegment(String owner) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT COALESCE(MAX(seg), -1) FROM entries WHERE owner = ?", new String[] { owner })) {
            return c.moveToFirst() ? c.getInt(0) : -1;
        }
    }

    /** 按自增编号顺序读取，网页用上次最后编号继续读，不会重复。 */
    public synchronized JSArray read(String owner, long afterId, int limit) throws JSONException {
        JSArray out = new JSArray();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id, time, kind, lat, lng, acc, seg FROM entries WHERE owner = ? AND id > ?"
                        + " ORDER BY id LIMIT ?",
                new String[] { owner, String.valueOf(afterId), String.valueOf(limit) })) {
            while (c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("id", c.getLong(0));
                o.put("time", c.getLong(1));
                o.put("kind", c.getString(2));
                o.put("segment", c.getInt(6));
                if ("fix".equals(c.getString(2))) {
                    o.put("lat", c.getDouble(3));
                    o.put("lng", c.getDouble(4));
                    o.put("accuracy", c.getDouble(5));
                }
                out.put(o);
            }
        }
        return out;
    }
}
