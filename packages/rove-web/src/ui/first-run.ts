/** The first-run screen (no task yet): the scroll frame, the column that holds the picture, copy and action. */
export const FIRST_RUN = "min-h-0 w-full overflow-y-auto"
/** Reading column, set a little below the top (a sixth of the height, at most 8rem) so the picture sits in the eye line. */
export const FIRST_RUN_COLUMN = "mx-auto mt-[min(16vh,8rem)] flex w-full max-w-130 flex-col gap-4 px-5 pb-7"

/** The ASCII picture's frame: fixed height (set inline), clipped, painted apart from the page so frames never reflow it. */
export const FLOW_FRAME =
  "relative grid w-full select-none overflow-hidden font-mono text-(length:--fs-body) text-subtle [contain:layout_paint]"
/** One of its two stacked layers; the tone comes from the frame or a text colour class. */
export const FLOW_LAYER = "col-start-1 row-start-1 m-0 whitespace-pre font-[inherit] leading-[inherit]"
/** The hidden ruler that measures one cell of the face. */
export const FLOW_RULER = "invisible absolute top-0 left-0 whitespace-pre"
