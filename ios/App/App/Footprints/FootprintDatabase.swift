import Foundation
import SQLite3

/// 设备本地足迹库，采集器直接写入，不经过 WebView。
final class FootprintDatabase {
    static let shared = FootprintDatabase()
    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "whereto.footprints.db")

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var url = dir.appendingPathComponent("footprints.sqlite")
        if sqlite3_open_v2(url.path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK {
            // 锁屏时也要能写入：首次解锁后即可访问，不使用默认的"完全保护"。
            try? (url as NSURL).setResourceValue(URLFileProtection.completeUntilFirstUserAuthentication, forKey: .fileProtectionKey)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
            exec("CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, time INTEGER NOT NULL, kind TEXT NOT NULL, lat REAL, lng REAL, acc REAL, seg INTEGER NOT NULL)")
            exec("CREATE INDEX IF NOT EXISTS entries_owner_id ON entries(owner, id)")
        }
    }

    @discardableResult
    private func exec(_ sql: String) -> Bool { sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK }

    @discardableResult
    func insert(owner: String, time: Int64, kind: String, lat: Double?, lng: Double?, acc: Double?, seg: Int) -> Bool {
        queue.sync {
            var stmt: OpaquePointer?
            let sql = "INSERT INTO entries (owner, time, kind, lat, lng, acc, seg) VALUES (?,?,?,?,?,?,?)"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
            defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            sqlite3_bind_text(stmt, 1, owner, -1, transient)
            sqlite3_bind_int64(stmt, 2, time)
            sqlite3_bind_text(stmt, 3, kind, -1, transient)
            if let lat, let lng, let acc {
                sqlite3_bind_double(stmt, 4, lat); sqlite3_bind_double(stmt, 5, lng); sqlite3_bind_double(stmt, 6, acc)
            } else {
                sqlite3_bind_null(stmt, 4); sqlite3_bind_null(stmt, 5); sqlite3_bind_null(stmt, 6)
            }
            sqlite3_bind_int(stmt, 7, Int32(seg))
            return sqlite3_step(stmt) == SQLITE_DONE
        }
    }

    func maxSegment(owner: String) -> Int {
        queue.sync {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, "SELECT COALESCE(MAX(seg), -1) FROM entries WHERE owner = ?", -1, &stmt, nil) == SQLITE_OK else { return -1 }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : -1
        }
    }

    func read(owner: String, afterId: Int64, limit: Int) -> [[String: Any]] {
        queue.sync {
            var stmt: OpaquePointer?
            let sql = "SELECT id, time, kind, lat, lng, acc, seg FROM entries WHERE owner = ? AND id > ? ORDER BY id LIMIT ?"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_int64(stmt, 2, afterId)
            sqlite3_bind_int(stmt, 3, Int32(limit))
            var rows: [[String: Any]] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                let kind = String(cString: sqlite3_column_text(stmt, 2))
                var row: [String: Any] = [
                    "id": sqlite3_column_int64(stmt, 0),
                    "time": sqlite3_column_int64(stmt, 1),
                    "kind": kind,
                    "segment": Int(sqlite3_column_int(stmt, 6)),
                ]
                if kind == "fix" {
                    row["lat"] = sqlite3_column_double(stmt, 3)
                    row["lng"] = sqlite3_column_double(stmt, 4)
                    row["accuracy"] = sqlite3_column_double(stmt, 5)
                }
                rows.append(row)
            }
            return rows
        }
    }
}
