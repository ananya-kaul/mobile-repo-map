import Foundation

enum SyncConflictPolicy {
    case lastWriterWins
    case preferLocal
    case preferRemote
    case merge
}

struct SyncConflict: Equatable {
    enum Resolution: Equatable {
        case keptLocal
        case keptRemote
        case merged
    }

    let id: UUID
    let resolution: Resolution
}

struct SyncPlan: Equatable {
    var upload: [Note] = []
    var download: [Note] = []
    var deleteLocally: [UUID] = []
    var deleteRemotely: [UUID] = []
    var conflicts: [SyncConflict] = []

    var isEmpty: Bool {
        upload.isEmpty && download.isEmpty && deleteLocally.isEmpty && deleteRemotely.isEmpty
    }
}

enum SyncError: Error, Equatable {
    case offline
    case notConfigured
    case clockSkew(seconds: TimeInterval)
    case duplicateRemoteID(UUID)
}

/// Reconciles local notes with the server change feed.
///
/// The rules grew one bug report at a time; see `SyncEngineTests` before touching them.
final class SyncEngine {
    var policy: SyncConflictPolicy
    private let transport: SyncTransport?
    private(set) var lastSyncedAt: Date?
    private let maxClockSkew: TimeInterval = 300

    init(transport: SyncTransport? = AlamofireSyncTransport(), policy: SyncConflictPolicy = .lastWriterWins) {
        self.transport = transport
        self.policy = policy
    }

    // MARK: - Network round trip

    func run(local: [Note], deletedIDs: Set<UUID>) async throws -> SyncPlan {
        guard let transport else { throw SyncError.notConfigured }
        let outgoing = local.filter(\.isDirty).map { note -> RemoteNote in
            RemoteNote(note, revision: note.syncedRevision ?? 0)
        }
        let payload = SyncPayload(since: lastSyncedAt, upserts: outgoing, deletions: Array(deletedIDs))
        let response = try await transport.exchange(payload)
        if abs(response.serverTime.timeIntervalSinceNow) > maxClockSkew {
            throw SyncError.clockSkew(seconds: response.serverTime.timeIntervalSinceNow)
        }
        var result = try plan(local: local, remote: response.changes, deletedLocally: deletedIDs)
        result.deleteRemotely = Array(deletedIDs)
        lastSyncedAt = response.serverTime
        return result
    }

    // MARK: - Planning

    func plan(local: [Note], remote: [RemoteNote], deletedLocally: Set<UUID> = []) throws -> SyncPlan {
        var plan = SyncPlan()
        var remoteByID: [UUID: RemoteNote] = [:]
        for change in remote {
            if let existing = remoteByID[change.id] {
                // The feed can repeat a note; keep the highest revision, but two
                // different payloads at the same revision means the server is confused.
                if existing.revision == change.revision && existing != change {
                    throw SyncError.duplicateRemoteID(change.id)
                } else if change.revision > existing.revision {
                    remoteByID[change.id] = change
                }
            } else {
                remoteByID[change.id] = change
            }
        }

        let localByID = Dictionary(uniqueKeysWithValues: local.map { ($0.id, $0) })

        for note in local {
            guard let theirs = remoteByID[note.id] else {
                // Not in the feed: either new locally or unchanged on the server.
                if note.isDirty || note.syncedRevision == nil {
                    plan.upload.append(note)
                }
                continue
            }

            if theirs.deleted {
                if note.isDirty && policy != .preferRemote {
                    // Edited here after being deleted elsewhere: resurrect it.
                    plan.upload.append(note)
                    plan.conflicts.append(SyncConflict(id: note.id, resolution: .keptLocal))
                } else {
                    plan.deleteLocally.append(note.id)
                }
                continue
            }

            let baseRevision = note.syncedRevision ?? -1
            let remoteChanged = theirs.revision > baseRevision
            switch (note.isDirty, remoteChanged) {
            case (false, false):
                continue
            case (false, true):
                plan.download.append(theirs.asNote(createdAt: note.createdAt))
            case (true, false):
                plan.upload.append(note)
            case (true, true):
                let (winner, resolution) = resolve(local: note, remote: theirs)
                switch resolution {
                case .keptLocal, .merged:
                    plan.upload.append(winner)
                    if resolution == .merged {
                        plan.download.append(winner)
                    }
                case .keptRemote:
                    plan.download.append(winner)
                }
                plan.conflicts.append(SyncConflict(id: note.id, resolution: resolution))
            }
        }

        for (id, theirs) in remoteByID where localByID[id] == nil {
            if theirs.deleted || deletedLocally.contains(id) {
                continue
            }
            plan.download.append(theirs.asNote(createdAt: theirs.updatedAt))
        }

        return plan
    }

    // MARK: - Conflict resolution

    func resolve(local: Note, remote: RemoteNote) -> (Note, SyncConflict.Resolution) {
        switch policy {
        case .preferLocal:
            return (local, .keptLocal)
        case .preferRemote:
            return (remote.asNote(createdAt: local.createdAt), .keptRemote)
        case .lastWriterWins:
            if local.updatedAt > remote.updatedAt {
                return (local, .keptLocal)
            } else if local.updatedAt < remote.updatedAt {
                return (remote.asNote(createdAt: local.createdAt), .keptRemote)
            } else {
                // Same timestamp: break the tie deterministically by content length.
                return local.body.count >= remote.body.count
                    ? (local, .keptLocal)
                    : (remote.asNote(createdAt: local.createdAt), .keptRemote)
            }
        case .merge:
            var merged = local
            if local.title != remote.title {
                if local.title.isEmpty || local.title == "Untitled" {
                    merged.title = remote.title
                } else if !remote.title.isEmpty && remote.updatedAt > local.updatedAt {
                    merged.title = remote.title
                }
            }
            merged.body = mergeBodies(local: local.body, remote: remote.body)
            merged.tags = Array(Set(local.tags).union(remote.tags)).sorted()
            merged.isPinned = local.isPinned || remote.isPinned
            merged.updatedAt = max(local.updatedAt, remote.updatedAt)
            merged.syncedRevision = remote.revision
            merged.isDirty = true
            if merged.body == local.body && merged.title == local.title && merged.tags == local.tags {
                return (local, .keptLocal)
            }
            return (merged, .merged)
        }
    }

    /// Line-level union that keeps local order and appends remote-only lines.
    func mergeBodies(local: String, remote: String) -> String {
        if local == remote { return local }
        if local.isEmpty { return remote }
        if remote.isEmpty { return local }
        if remote.hasPrefix(local) { return remote }
        if local.hasPrefix(remote) { return local }

        let localLines = local.components(separatedBy: "\n")
        let remoteLines = remote.components(separatedBy: "\n")
        var seen = Set(localLines)
        var result = localLines
        for line in remoteLines {
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            if !seen.contains(line) {
                result.append(line)
                seen.insert(line)
            }
        }
        return result.joined(separator: "\n")
    }
}
