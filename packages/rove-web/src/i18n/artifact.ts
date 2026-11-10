/** `artifact` messages: the Files pane's rendered preview of a markdown, HTML, SVG, image or PDF file. English is the source of truth; `zh: typeof en` keeps the shapes locked together. */
export const en = {
  artifact: {
    preview: "preview",
    source: "source",
    open: "[ open ]",
    loading: "Loading…",
    tooLarge: "Too large to preview ({size}); the source view reads it as text.",
    notPreviewable: "This file cannot be previewed.",
    gone: "The file is gone.",
    failed: "Could not read the file: {error}",
  },
}

export const zh: typeof en = {
  artifact: {
    preview: "预览",
    source: "源码",
    open: "[ 打开 ]",
    loading: "加载中…",
    tooLarge: "文件太大，无法预览（{size}）；可在源码视图中按文本查看。",
    notPreviewable: "这个文件无法预览。",
    gone: "文件已不存在。",
    failed: "无法读取文件：{error}",
  },
}
