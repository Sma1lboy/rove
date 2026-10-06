import XCTest
@testable import RoveMobile

final class FilesTests: XCTestCase {
    private func dec<T: Decodable>(_ json: String, as: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: diff numbering (must match the TUI's unifiedDiffRows, or notes point at the wrong line)

    func testLineNumbersFollowHunksAndSides() {
        let patch = """
        diff --git a/a.ts b/a.ts
        index 1..2 100644
        --- a/a.ts
        +++ b/a.ts
        @@ -10,3 +10,3 @@
         keep
        --- removed dashes
        +added
         tail
        @@ -40 +40,2 @@
         ctx
        +more

        """
        let rows = DiffParser.lines(patch)
        XCTAssertEqual(rows.prefix(4).map(\.kind), [.meta, .meta, .meta, .meta])
        let body = rows.dropFirst(4).map { ($0.kind, $0.number) }
        XCTAssertEqual(body.map(\.1), [nil, 10, 11, 11, 12, nil, 40, 41])
        XCTAssertEqual(body.map(\.0), [.hunk, .context, .removed, .added, .context, .hunk, .context, .added])
        XCTAssertFalse(rows.contains { $0.text.isEmpty }, "the patch's trailing newline is not a row")
    }

    func testRangeCollapsesWhenEndpointsDoNotOrder() {
        let rows = DiffParser.lines("@@ -5,2 +5,2 @@\n-a\n+b\n c\n")
        let ordered = DiffParser.range(rows, cursor: 3, anchor: 1)
        XCTAssertEqual([ordered?.startLine, ordered?.line], [5, 6])
        // removed(old 5) .. added(new 5): not increasing, so it collapses to the end line
        XCTAssertEqual(DiffParser.range(rows, cursor: 2, anchor: 1)?.startLine, nil)
        XCTAssertNil(DiffParser.range(rows, cursor: 0, anchor: nil), "a hunk header cannot carry a note")
    }

    func testSelectionTapExtendsThenRestarts() {
        var s = DiffSelection()
        s.tap(2); XCTAssertEqual([s.anchor, s.cursor], [2, 2])
        s.tap(5); XCTAssertEqual([s.anchor, s.cursor], [2, 5]); XCTAssertTrue(s.contains(4))
        s.tap(1); XCTAssertEqual([s.anchor, s.cursor], [1, 1])
        s.tap(1); XCTAssertTrue(s.isEmpty)
    }

    func testCombinedPatchSplitsPerFileWithCounts() {
        let patch = "diff --git a/x/a.ts b/x/a.ts\n@@ -1 +1 @@\n-1\n+2\ndiff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n"
        let s = CombinedDiff.sections(patch)
        XCTAssertEqual(s.map(\.path), ["x/a.ts", "new.ts"])
        XCTAssertEqual([s[0].added, s[0].deleted, s[1].added, s[1].deleted], [1, 1, 0, 0])
    }

    // MARK: single-file states

    func testEveryHunklessStateIsSpelledOut() throws {
        func state(_ json: String) throws -> DiffFileState? { DiffFileState.describe(try dec(json, as: DiffFileResult.self)) }
        XCTAssertEqual(try state(#"{"kind":"patch-note","note":{"kind":"rename","from":"a.ts","to":"b.ts"},"sizeBytes":3}"#)?.title, "renamed")
        XCTAssertTrue(try state(#"{"kind":"patch-note","note":{"kind":"rename","from":"a.ts","to":"b.ts"},"sizeBytes":3}"#)?.detail?.contains("a.ts → b.ts") == true)
        XCTAssertEqual(try state(#"{"kind":"patch-note","note":{"kind":"mode","from":"100644","to":"100755"},"sizeBytes":3}"#)?.detail, "100644 → 100755 · contents unchanged")
        XCTAssertEqual(try state(#"{"kind":"patch-note","note":{"kind":"empty-file","change":"deleted"},"sizeBytes":0}"#)?.title, "empty file deleted")
        XCTAssertEqual(try state(#"{"kind":"patch-note","note":{"kind":"binary"},"sizeBytes":2048}"#)?.title, "binary file changed")
        XCTAssertEqual(try state(#"{"kind":"binary","image":true,"sizeBytes":null}"#)?.title, "image")
        XCTAssertEqual(try state(#"{"kind":"empty"}"#)?.title, "no changes")
        XCTAssertNil(try state(#"{"kind":"diff","text":"@@ -1 +1 @@\n-a\n+b","origPath":"old.ts"}"#))
        XCTAssertNil(try state(#"{"kind":"code","text":"x"}"#))
    }

    func testPlusMinusCounts() {
        XCTAssertEqual(DiffFileState.counts("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n--b\n+c\n d\n").added, 1)
        XCTAssertEqual(DiffFileState.counts("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n--b\n+c\n d\n").deleted, 2, "a removed line starting with -- is still a deletion")
    }

    // MARK: wire compat — with and without every optional field

    func testDiffFileResultDecodesOldAndNew() throws {
        let old = try dec(#"{"kind":"diff","text":"@@ -1 +1 @@\n-a\n+b"}"#, as: DiffFileResult.self)
        XCTAssertNil(old.origPath); XCTAssertNil(old.note)
        let new = try dec(#"{"kind":"diff","text":"x","origPath":"a.ts"}"#, as: DiffFileResult.self)
        XCTAssertEqual(new.origPath, "a.ts")
        let note = try dec(#"{"kind":"patch-note","note":{"kind":"mode","from":"100644","to":"100755"},"sizeBytes":null}"#, as: DiffFileResult.self)
        XCTAssertEqual(note.note?.kind, "mode"); XCTAssertNil(note.sizeBytes)
    }

    func testReviewNoteDecodesWithAndWithoutRangeAndSentAt() throws {
        let plain = try dec(#"{"id":"a","filePath":"f.ts","line":4,"body":"b","createdAt":1}"#, as: ReviewNote.self)
        XCTAssertFalse(plain.isSent); XCTAssertEqual(plain.lineLabel, "4")
        let full = try dec(#"{"id":"a","filePath":"f.ts","startLine":2,"line":4,"body":"b","createdAt":1,"sentAt":9}"#, as: ReviewNote.self)
        XCTAssertTrue(full.isSent); XCTAssertEqual(full.lineLabel, "2–4")
        XCTAssertEqual(try dec(#"{"notes":[],"unsent":0}"#, as: ReviewListResult.self).unsent, 0)
        XCTAssertNil(try dec(#"{"notes":[]}"#, as: ReviewListResult.self).unsent)
    }

    func testFilesListAndWorktreeRowsDecodeWithAndWithoutJoin() throws {
        XCTAssertNil(try dec(#"{"files":["a"]}"#, as: FilesListResult.self).truncated)
        XCTAssertEqual(try dec(#"{"files":["a"],"truncated":true}"#, as: FilesListResult.self).truncated, true)
        let bare = try dec(#"{"path":"/w","branch":"b","dirty":null,"branchOnRemote":null}"#, as: WorktreeRow.self)
        XCTAssertFalse(bare.canLand)
        let joined = try dec(#"{"path":"/w","branch":"b","dirty":false,"taskId":"t1","taskKind":"task","verdictReason":"prMerged"}"#, as: WorktreeRow.self)
        XCTAssertTrue(joined.canLand)
        let main = try dec(#"{"path":"/w","branch":"main","taskId":"t0","taskKind":"main"}"#, as: WorktreeRow.self)
        XCTAssertFalse(main.canLand, "a project's main checkout never lands")
    }

    // MARK: browse, mention, worktrees

    func testBrowseListsDirectoriesFirstAndCountsFiles() {
        let files = ["README.md", "src/a.ts", "src/lib/b.ts", "src/lib/c.ts", "docs/x.md", "10.txt", "2.txt"]
        let root = FileTreeLogic.entries(files, in: "")
        XCTAssertEqual(root.map(\.path), ["docs/", "src/", "2.txt", "10.txt", "README.md"])
        XCTAssertEqual(root[1].kind, .dir(files: 3))
        XCTAssertEqual(FileTreeLogic.entries(files, in: "src/").map(\.name), ["lib", "a.ts"])
        XCTAssertEqual(FileTreeLogic.crumbs("src/lib/").map(\.path), ["src/", "src/lib/"])
        XCTAssertEqual(FileTreeLogic.parent(of: "src/lib/b.ts"), "src/lib/")
        XCTAssertEqual(FileTreeLogic.parent(of: "README.md"), "")
        XCTAssertEqual(FileTreeLogic.search(files, " LIB/ "), ["src/lib/b.ts", "src/lib/c.ts"], "surrounding spaces are trimmed")
        XCTAssertEqual(FileTreeLogic.search(files, "   "), [])
        XCTAssertEqual(FileTreeLogic.search(files, "LIB/"), ["src/lib/b.ts", "src/lib/c.ts"])
    }

    @MainActor func testMentionIsTheTUIFormAndOnlyForItsTask() {
        let bus = MentionBus()
        bus.post(taskId: "t1", path: "src/a b.ts")
        XCTAssertNil(bus.take(taskId: "t2"))
        XCTAssertEqual(bus.take(taskId: "t1"), "@src/a b.ts")
        XCTAssertNil(bus.take(taskId: "t1"), "taken once")
    }

    func testWorktreeTagsDistinguishUnknownFromClean() throws {
        let unknown = try dec(#"{"path":"/w","branch":"b","dirty":null,"branchOnRemote":null,"verdictReason":"fresh"}"#, as: WorktreeRow.self)
        XCTAssertEqual(WorktreesLogic.tags(unknown).map(\.text), ["dirty?", "remote ?"])
        let done = try dec(#"{"path":"/w","branch":"b","dirty":true,"roveManaged":true,"branchOnRemote":false,"verdictReason":"inMain"}"#, as: WorktreeRow.self)
        XCTAssertEqual(WorktreesLogic.tags(done).map(\.text), ["rove", "dirty", "not pushed", "in main"])
        let now = Date(timeIntervalSince1970: 10_000_000)
        XCTAssertEqual(WorktreesLogic.age(ms: 10_000_000_000 - 3 * 86_400_000, now: now), "3d")
        XCTAssertNil(WorktreesLogic.age(ms: 0, now: now))
    }
}
