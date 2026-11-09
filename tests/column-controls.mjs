export async function toggleColumns(page) {
  await page.locator(".cl-toggle").click();
}

// Native scrollbar tracks belong to the viewport, not separate DOM elements.
export async function columnScrollbar(page, axis = "x") {
  return page.locator(".cl-viewport").evaluate((v, axis) => {
    const r = v.getBoundingClientRect(), scale = r.width / v.offsetWidth;
    const horizontal = axis === "x", button = 16 * scale;
    const client = horizontal ? v.clientWidth : v.clientHeight;
    const full = horizontal ? v.scrollWidth : v.scrollHeight;
    const offset = horizontal ? v.scrollLeft : v.scrollTop;
    const length = client * scale - 2 * button;
    const thumb = length * client / full;
    const x = horizontal ? r.x + button : r.x + v.clientWidth * scale;
    const y = horizontal ? r.y + v.clientHeight * scale : r.y + button;
    return { x, y, width: horizontal ? length : (v.offsetWidth - v.clientWidth) * scale,
      height: horizontal ? (v.offsetHeight - v.clientHeight) * scale : length,
      center: (horizontal ? x : y) + (length - thumb) * offset / (full - client) + thumb / 2 };
  }, axis);
}
