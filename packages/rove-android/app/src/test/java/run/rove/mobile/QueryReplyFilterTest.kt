package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.domain.QueryReplyFilter

class QueryReplyFilterTest {
    @Test fun terminalQueryRepliesNeverReachTheEngineButKeysAndCursorReportsDo() {
        assertEquals("", QueryReplyFilter.filter("\u001b[?1;2c\u001b[>0;276;0c"))
        assertEquals("", QueryReplyFilter.filter("\u001b[?2004;2\$y"))
        assertEquals("", QueryReplyFilter.filter("\u001b]11;rgb:1414/1414/1313\u001b\\\u001b]10;rgb:eaea/e7e7/dfdf\u0007"))
        assertEquals("ab", QueryReplyFilter.filter("a\u001b[?1;2cb"))
        for (kept in listOf("\u001b", "\u001b[A", "\u001b[Z", "\u001b[12;40R", "\u0003", "你好")) assertEquals(kept, QueryReplyFilter.filter(kept))
    }
}
