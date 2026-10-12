package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.domain.*

class DiffParseTest {
    private val patch = """
        diff --git a/src/a.ts b/src/a.ts
        index 3b1c9d2..a7e4f10 100644
        --- a/src/a.ts
        +++ b/src/a.ts
        @@ -1,3 +1,4 @@ head
         one
        -two
        +two!
        +two?
         three
        @@ -20 +30,2 @@
        --not a header
        +added
        \ No newline at end of file
        diff --git a/old.ts b/new.ts
        --- a/old.ts
        +++ b/new.ts
        @@ -1 +1 @@
        -x
        +y
    """.trimIndent() + "\n"

    @Test fun numbersEachHunkFromItsOwnHeaderAndKeepsRemovedLinesOnTheOldSide() {
        val rows = DiffParse.lines(patch)
        fun number(text: String) = rows.first { it.text == text }.number
        assertEquals(listOf(DiffLineKind.Meta, DiffLineKind.Meta, DiffLineKind.Meta, DiffLineKind.Meta, DiffLineKind.Hunk),
            rows.take(5).map { it.kind })
        assertEquals(1, number(" one")); assertEquals(2, number("-two")); assertEquals(2, number("+two!"))
        assertEquals(3, number("+two?")); assertEquals(4, number(" three"))
        assertEquals(20, number("--not a header")); assertEquals(30, number("+added"))
        assertEquals(DiffLineKind.Meta, rows.first { it.text.startsWith("\\") }.kind)
        assertEquals(DiffLineKind.Meta, rows.first { it.text == "--- a/old.ts" }.kind)
        assertEquals(1, rows.last().number)
    }

    @Test fun countsAndSectionsFollowTheRowsNotTheHeaders() {
        assertEquals(DiffCounts(4, 3), DiffParse.counts(patch))
        val sections = DiffParse.sections(patch)
        assertEquals(listOf("src/a.ts", "new.ts"), sections.map { it.path })
        assertEquals(listOf(3 to 2, 1 to 1), sections.map { it.added to it.deleted })
    }

    @Test fun groupsFilesByDirectoryInNaturalOrder() {
        fun file(path: String) = DiffFile(path, "M", "working")
        val groups = DiffParse.groups(listOf(file("src/10/b.ts"), file("README.md"), file("src/9/a.ts"), file("src/9/c.ts")))
        assertEquals(listOf("", "src/9/", "src/10/"), groups.map { it.dir })
        assertEquals(listOf("src/9/a.ts", "src/9/c.ts"), groups[1].files.map { it.path })
    }
}
